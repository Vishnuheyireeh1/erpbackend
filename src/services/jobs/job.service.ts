import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import { nextDocNo, toDocDate } from '../../utils/financialYear'
import { taxModeFor } from '../../utils/gst'
import type { JobCreateInput, JobUpdateInput } from '../../validators/job.validator'
import { audit } from '../audit.service'
import { deleteImage } from '../product/product.image'
import { getSetting } from '../settings.service'
import { autoEntriesTx, syncAutoEntriesTx } from './job.costs'
import { postLinesTx, priceLines, soldTotal, takePaymentTx } from './job.items'
import { getJob } from './job.query'
import { itemData, loadRefs, lockOpenJob, recalcJobTx } from './job.rules'

const TX = { timeout: 30_000, maxWait: 20_000 }
const r2 = (n: number) => Math.round(n * 100) / 100

async function gstRateFor(applied: boolean) {
  const [profile, gst] = await Promise.all([getSetting('business.profile'), getSetting('jobs.gst')])
  return applied && profile.gstRegistered ? gst.rate : 0
}

// Book a job: the bill (JOB/…) exists from today; advance = receipt allocated to it (+ optional old advance / credit).
export async function createJob(input: JobCreateInput, user: string) {
  const { date, isFuture } = toDocDate(input.docDate)
  if (isFuture) throw ApiError.badRequest("Order date can't be in the future")
  if (input.expectedDate < date.toISOString().slice(0, 10)) throw ApiError.badRequest('Ready-by date is before the order date')
  const customer = await prisma.customer.findUnique({ where: { id: input.customerId } })
  if (!customer) throw ApiError.badRequest('Selected customer no longer exists')
  if (!customer.isActive) throw ApiError.badRequest(`Customer "${customer.name}" is inactive`)
  if (input.parentJobId) {
    const parent = await prisma.stitchingJob.findUnique({ where: { id: input.parentJobId }, select: { customerId: true, status: true } })
    if (!parent || parent.customerId !== customer.id) throw ApiError.badRequest('The original job is not of this customer')
    if (parent.status === 'CANCELLED') throw ApiError.badRequest('The original job is cancelled')
  }
  const refs = await loadRefs(input.items)
  const [profile, allowNegative] = await Promise.all([getSetting('business.profile'), getSetting('inventory.allowNegativeStock')])
  const gstRate = await gstRateFor(input.gstApplied)
  const taxMode = taxModeFor(profile.stateCode, customer.stateCode)
  const products = await priceLines(input.products, taxMode)

  const id = await prisma.$transaction(async (tx) => {
    const docNo = await nextDocNo(tx, 'JOB', date)
    const job = await tx.stitchingJob.create({
      data: {
        docNo, customerId: customer.id, customerName: customer.name, customerPhone: customer.phone, docDate: date,
        expectedDate: new Date(`${input.expectedDate}T00:00:00Z`), parentJobId: input.parentJobId,
        taxMode, gstRate, discount: input.discount,
        notes: input.notes, internalNotes: input.internalNotes, bookNo: input.bookNo || null, createdBy: user,
        items: { create: input.items.map((i, k) => itemData(i, k, refs.garmentName)) },
        costs: { create: input.costs },
        logs: { create: { toStatus: 'PENDING', by: user, note: 'Booked' } },
      },
    })
    // Usual costs of each garment (cutting master, hand work …) as cost entries.
    await autoEntriesTx(tx, job.id, await tx.jobItem.findMany({ where: { jobId: job.id }, select: { id: true, garmentTypeId: true, qty: true, description: true } }), date, user)
    if (products.length) await postLinesTx(tx, job, products, { user, date, allowNegative })
    const calc = await recalcJobTx(tx, job.id)
    // Advance now (old advance / credit first if asked); items sold must be paid in full.
    const pay = await takePaymentTx(tx, job.id, { itemsDue: soldTotal(products), tenders: input.tenders, useAdvance: input.useAdvance, date, user, note: `Advance for ${docNo}` })
    const itemsText = products.length ? `, ${products.length} item(s)` : ''
    await audit(tx, { actor: user, action: 'job.create', entity: 'job', entityId: job.id, summary: `${docNo} — ${customer.name}, ${input.items.length} garment(s)${itemsText}, ₹${calc.grandTotal}, paid ₹${r2(pay.paid + pay.advance)}, due ${input.expectedDate}` })
    return job.id
  }, TX)
  return getJob(id)
}

// Edit an open job (garments, charges, extra costs, discount, GST tick, dates, notes). Materials have their own actions.
export async function updateJob(id: number, input: JobUpdateInput, user: string) {
  const current = await prisma.stitchingJob.findUnique({ where: { id }, include: { items: { select: { id: true, imagePath: true } } } })
  if (!current) throw ApiError.notFound('Job not found')
  const existing = new Set(current.items.map((i) => i.id))
  for (const i of input.items) if (i.id && !existing.has(i.id)) throw ApiError.badRequest('A garment line is not part of this job')
  if (input.expectedDate < current.docDate.toISOString().slice(0, 10)) throw ApiError.badRequest('Ready-by date is before the order date')
  const refs = await loadRefs(input.items, existing)
  const newRate = input.gstApplied ? (Number(current.gstRate) > 0 ? Number(current.gstRate) : await gstRateFor(true)) : 0
  const keep = new Set(input.items.map((i) => i.id).filter(Boolean))
  const removed = current.items.filter((i) => !keep.has(i.id))

  await prisma.$transaction(async (tx) => {
    const before = await lockOpenJob(tx, id)
    await syncAutoEntriesTx(tx, input.items.filter((i) => i.id).map((i) => ({ id: i.id!, qty: i.qty })), removed.map((r) => r.id))
    await tx.jobItem.deleteMany({ where: { jobId: id, id: { in: removed.map((r) => r.id) } } })
    const added: { id: number; garmentTypeId: number; qty: number; description: string }[] = []
    for (const [k, i] of input.items.entries()) {
      const data = itemData(i, k, refs.garmentName)
      if (i.id) await tx.jobItem.update({ where: { id: i.id }, data })
      else added.push(await tx.jobItem.create({ data: { ...data, jobId: id }, select: { id: true, garmentTypeId: true, qty: true, description: true } }))
    }
    await autoEntriesTx(tx, id, added, toDocDate(undefined).date, user)
    await tx.jobCost.deleteMany({ where: { jobId: id } })
    if (input.costs.length) await tx.jobCost.createMany({ data: input.costs.map((c) => ({ ...c, jobId: id })) })
    await tx.stitchingJob.update({
      where: { id },
      data: { expectedDate: new Date(`${input.expectedDate}T00:00:00Z`), gstRate: newRate, discount: input.discount, notes: input.notes, internalNotes: input.internalNotes, ...(input.bookNo !== undefined ? { bookNo: input.bookNo || null } : {}) },
    })
    const calc = await recalcJobTx(tx, id)
    const changed = Number(before.grandTotal) !== calc.grandTotal ? `, total ₹${before.grandTotal} → ₹${calc.grandTotal}` : ''
    await audit(tx, { actor: user, action: 'job.update', entity: 'job', entityId: id, summary: `${before.docNo} edited — ${input.items.length} garment(s)${changed}` })
  }, TX)
  await Promise.all(removed.map((r) => deleteImage(r.imagePath, 'jobs')))
  return getJob(id)
}
