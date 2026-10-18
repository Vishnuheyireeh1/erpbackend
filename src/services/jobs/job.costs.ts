import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import { toDocDate } from '../../utils/financialYear'
import type { JobCostEntryInput } from '../../validators/job.validator'
import { audit } from '../audit.service'
import { getJob } from './job.query'

// Job cost entries: what the shop spends on a job (cutting, hand work, embroidery …) and WHO did it, added any time —
// even after hand over. They lower the job's profit; the bill does not change.
//   WORKER   = our per-piece worker → owed to them (their balance) once the job is Ready
//   SALARIED = staff on monthly salary → cost for job profit only
//   PAID     = paid out now (cash / UPI …) → day book

type Tx = Prisma.TransactionClient
const r2 = (n: number) => Math.round(n * 100) / 100

// The worker who did it must exist, be active (for new work) and — for "owed to the worker" — be per piece.
async function checkWorker(input: JobCostEntryInput, keepId?: number | null) {
  if (!input.tailorId) return null
  const w = await prisma.tailor.findUnique({ where: { id: input.tailorId }, select: { id: true, name: true, payType: true, isActive: true } })
  if (!w) throw ApiError.badRequest('Choose who did the work')
  if (!w.isActive && w.id !== keepId) throw ApiError.badRequest(`${w.name} is inactive`)
  if (input.paidBy === 'WORKER' && w.payType !== 'PIECE') throw ApiError.badRequest(`${w.name} is on salary — choose "Salaried (cost only)"`)
  return w
}
const howPaid = (e: JobCostEntryInput, who: string) => (e.paidBy === 'PAID' ? `paid ${e.mode}` : e.paidBy === 'WORKER' ? `owed to ${who}` : 'salaried') + (e.paidBy !== 'WORKER' && who ? ` · by ${who}` : '')
const entryData = (input: JobCostEntryInput, date: Date) => ({
  date, description: input.description, qty: input.qty, rate: input.rate, amount: r2(input.qty * input.rate),
  paidBy: input.paidBy, mode: input.paidBy === 'PAID' ? input.mode : null, tailorId: input.tailorId,
})

export async function openJob(jobId: number) {
  const job = await prisma.stitchingJob.findUnique({ where: { id: jobId }, select: { docNo: true, status: true } })
  if (!job) throw ApiError.notFound('Job not found')
  if (job.status === 'CANCELLED') throw ApiError.conflict(`${job.docNo} is cancelled`)
  return job
}

export async function addCostEntry(jobId: number, input: JobCostEntryInput, user: string) {
  const { date, isFuture } = toDocDate(input.date)
  if (isFuture) throw ApiError.badRequest("Date can't be in the future")
  const [job, category, worker] = await Promise.all([openJob(jobId), prisma.jobCostCategory.findUnique({ where: { id: input.categoryId } }), checkWorker(input)])
  if (!category || !category.isActive) throw ApiError.badRequest('Choose an active work / cost type')
  await prisma.$transaction(async (tx) => {
    const e = await tx.jobCostEntry.create({ data: { jobId, categoryId: category.id, ...entryData(input, date), createdBy: user } })
    await audit(tx, { actor: user, action: 'job.cost.add', entity: 'job', entityId: jobId, summary: `${job.docNo}: ${category.name} ₹${e.amount} (${howPaid(input, worker?.name ?? '')})` })
  })
  return getJob(jobId)
}

// Change a work / cost line — e.g. the workshop sets who did the cutting on an automatic line.
export async function updateCostEntry(jobId: number, entryId: number, input: JobCostEntryInput, user: string) {
  const e = await prisma.jobCostEntry.findFirst({ where: { id: entryId, jobId } })
  if (!e) throw ApiError.notFound('Work line not found')
  const { date, isFuture } = toDocDate(input.date ?? e.date.toISOString().slice(0, 10))
  if (isFuture) throw ApiError.badRequest("Date can't be in the future")
  const [job, category, worker] = await Promise.all([openJob(jobId), prisma.jobCostCategory.findUnique({ where: { id: input.categoryId } }), checkWorker(input, e.tailorId)])
  if (!category || (!category.isActive && category.id !== e.categoryId)) throw ApiError.badRequest('Choose an active work / cost type')
  await prisma.$transaction(async (tx) => {
    // Edited by hand → no longer follows the garment's pieces automatically.
    const saved = await tx.jobCostEntry.update({ where: { id: entryId }, data: { categoryId: category.id, ...entryData(input, date), auto: false } })
    await audit(tx, { actor: user, action: 'job.cost.update', entity: 'job', entityId: jobId, summary: `${job.docNo}: ${category.name} ₹${e.amount} → ₹${saved.amount} (${howPaid(input, worker?.name ?? '')})` })
  })
  return getJob(jobId)
}

export async function removeCostEntry(jobId: number, entryId: number, user: string) {
  const e = await prisma.jobCostEntry.findFirst({ where: { id: entryId, jobId }, include: { category: true, job: { select: { docNo: true } } } })
  if (!e) throw ApiError.notFound('Cost line not found')
  await prisma.$transaction(async (tx) => {
    await tx.jobCostEntry.delete({ where: { id: entryId } })
    await audit(tx, { actor: user, action: 'job.cost.remove', entity: 'job', entityId: jobId, summary: `${e.job.docNo}: ${e.category.name} ₹${e.amount} removed` })
  })
  return getJob(jobId)
}

// Garment's usual costs per piece (e.g. Churidar: Cutting master ₹140) → cost entries for NEW garment lines.
export async function autoEntriesTx(tx: Tx, jobId: number, items: { id: number; garmentTypeId: number; qty: number; description: string }[], date: Date, user: string) {
  if (!items.length) return
  const defaults = await tx.garmentCostDefault.findMany({
    where: { garmentTypeId: { in: [...new Set(items.map((i) => i.garmentTypeId))] }, rate: { gt: 0 }, category: { isActive: true } },
    include: { category: true },
  })
  const data = items.flatMap((i) =>
    defaults.filter((d) => d.garmentTypeId === i.garmentTypeId).map((d) => ({
      jobId, categoryId: d.categoryId, jobItemId: i.id, auto: true, date, description: i.description, qty: i.qty, rate: d.rate,
      amount: r2(i.qty * Number(d.rate)), paidBy: d.category.defaultPaidBy, mode: d.category.defaultPaidBy === 'PAID' ? ('CASH' as const) : null, createdBy: user,
    })),
  )
  if (data.length) await tx.jobCostEntry.createMany({ data })
}

// Garment line edited: its automatic costs follow the new number of pieces (rate kept); removed lines lose theirs.
export async function syncAutoEntriesTx(tx: Tx, kept: { id: number; qty: number }[], removedIds: number[]) {
  if (removedIds.length) await tx.jobCostEntry.deleteMany({ where: { auto: true, jobItemId: { in: removedIds } } })
  for (const i of kept) {
    await tx.$executeRaw`UPDATE job_cost_entries SET qty = ${i.qty}::numeric, amount = ROUND(${i.qty}::numeric * rate, 2) WHERE auto AND job_item_id = ${i.id} AND qty <> ${i.qty}::numeric`
  }
}
