import { prisma } from '../../config/prisma'
import type { JobStatus } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import { toDocDate } from '../../utils/financialYear'
import type { JobDeliverInput } from '../../validators/job.validator'
import { audit } from '../audit.service'
import { postMovements } from '../inventory/stock.engine'
import { createReceiptTx } from '../sales/receipt.service'
import { applyAdvanceTx, releaseDocTx } from '../sales/settle.service'
import { getSetting } from '../settings.service'
import { getJob } from './job.query'
import { lockOpenJob } from './job.rules'

const TX = { timeout: 30_000, maxWait: 20_000 }
const r2 = (n: number) => Math.round(n * 100) / 100
export const statusLabels: Record<JobStatus, string> = {
  PENDING: 'Booked', CUTTING: 'Cutting', STITCHING: 'Stitching', TRIAL: 'Trial / alteration', READY: 'Ready', DELIVERED: 'Handed over', CANCELLED: 'Cancelled',
}

// Move an open job to another stage (any direction — e.g. back to Trial after a fitting). Ready = tailor labour earned.
export async function setStatus(id: number, status: JobStatus, note: string | null, user: string) {
  await prisma.$transaction(async (tx) => {
    const job = await lockOpenJob(tx, id)
    if (job.status === status) throw ApiError.badRequest(`${job.docNo} is already ${statusLabels[status]}`)
    await tx.stitchingJob.update({ where: { id }, data: { status } })
    await tx.jobStatusLog.create({ data: { jobId: id, fromStatus: job.status, toStatus: status, note, by: user } })
    await audit(tx, { actor: user, action: 'job.status', entity: 'job', entityId: id, summary: `${job.docNo}: ${statusLabels[job.status]} → ${statusLabels[status]}${note ? ` (${note})` : ''}` })
  }, TX)
  return getJob(id)
}

// Hand over: use advance / credit if asked, take the balance, mark Delivered. A balance may stay (customer account).
export async function deliverJob(id: number, input: JobDeliverInput, user: string) {
  const { date, isFuture } = toDocDate(input.docDate)
  if (isFuture) throw ApiError.badRequest("Date can't be in the future")
  await prisma.$transaction(async (tx) => {
    const job = await lockOpenJob(tx, id)
    const advance = input.useAdvance ? await applyAdvanceTx(tx, job.customerId, 'JOB', id, user) : 0
    const due = r2(Number(job.grandTotal) - Number(job.paidAmount) - Number(job.returnedAmount) - advance)
    const paid = r2(input.tenders.reduce((s, t) => s + t.amount, 0))
    if (paid > due + 0.004) throw ApiError.badRequest(`Only ₹${due} is due on ${job.docNo}`)
    if (paid > 0) await createReceiptTx(tx, { customerId: job.customerId, docDate: date, tenders: input.tenders, notes: `Balance for ${job.docNo}`, allocations: [{ jobId: id, amount: paid }] }, user)
    await tx.stitchingJob.update({ where: { id }, data: { status: 'DELIVERED', deliveredAt: new Date() } })
    await tx.jobStatusLog.create({ data: { jobId: id, fromStatus: job.status, toStatus: 'DELIVERED', note: input.note, by: user } })
    const left = r2(due - paid)
    await audit(tx, { actor: user, action: 'job.deliver', entity: 'job', entityId: id, summary: `${job.docNo} delivered — received ₹${paid}${advance ? `, advance used ₹${advance}` : ''}${left > 0 ? `, ₹${left} still due` : ''}` })
  }, TX)
  return getJob(id)
}

// Cancel a job that was not delivered: shop materials go back to stock, money paid stays as the customer's advance.
export async function cancelJob(id: number, reason: string, user: string) {
  const open = await prisma.stitchingJob.count({ where: { parentJobId: id, status: { not: 'CANCELLED' } } })
  if (open) throw ApiError.conflict('This job has alteration jobs — cancel those first')
  if (await prisma.salesReturn.count({ where: { jobId: id, status: 'POSTED' } })) throw ApiError.conflict('Items on this job were returned — cancel those returns first')
  const allowNegative = await getSetting('inventory.allowNegativeStock')
  await prisma.$transaction(async (tx) => {
    const job = await lockOpenJob(tx, id)
    const materials = await tx.jobMaterial.findMany({ where: { jobId: id } })
    await postMovements(
      tx,
      materials.map((m) => ({ variantId: m.variantId, qty: Number(m.qty), unitCost: Number(m.unitCost), type: 'CANCELLATION' as const, note: `Cancelled ${job.docNo}: ${reason}` })),
      { refType: 'JOB', refId: id, refNo: job.docNo, date: toDocDate(undefined).date, user, allowNegative },
    )
    await releaseDocTx(tx, 'JOB', id, job.docNo, user)
    await tx.stitchingJob.update({ where: { id }, data: { status: 'CANCELLED', cancelledBy: user, cancelledAt: new Date(), cancelReason: reason } })
    await tx.jobStatusLog.create({ data: { jobId: id, fromStatus: job.status, toStatus: 'CANCELLED', note: reason, by: user } })
    await audit(tx, { actor: user, action: 'job.cancel', entity: 'job', entityId: id, summary: `${job.docNo} cancelled — ${reason}` })
  }, TX)
  return getJob(id)
}
