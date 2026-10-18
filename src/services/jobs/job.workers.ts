import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import { toDocDate } from '../../utils/financialYear'
import type { JobWorkersInput } from '../../validators/job.validator'
import { audit } from '../audit.service'
import { openJob } from './job.costs'
import { getJob } from './job.query'

// Job work → "Assign workers" (set by the workshop after billing, any time — even after hand over). Per garment:
//   stitching   = the garment line: tailor + pay per piece (+ a note when the pay was changed)
//   other work  = one work line per work done (Cutting, Lining, Embroidery …) with who did it
// Per-piece people → pay owed to them once the job is Ready (WORKER). Salaried people → no pay, only who did it (SALARIED).
// The garment's work lines are replaced as a whole set; money paid out in cash (PAID lines) is never touched.

const r2 = (n: number) => Math.round(n * 100) / 100

export async function setWorkers(jobId: number, input: JobWorkersInput, user: string) {
  const job = await openJob(jobId)
  const items = await prisma.jobItem.findMany({ where: { jobId }, select: { id: true, description: true, tailorId: true, qty: true } })
  const itemIds = items.map((i) => i.id)
  const [workers, categories, existing] = await Promise.all([
    prisma.tailor.findMany({ where: { id: { in: [...new Set(input.items.flatMap((i) => [i.tailorId, ...i.works.map((w) => w.tailorId)]).filter((v): v is number => !!v))] } }, select: { id: true, name: true, isActive: true, payType: true } }),
    prisma.jobCostCategory.findMany({ where: { id: { in: [...new Set(input.items.flatMap((i) => i.works.map((w) => w.categoryId)))] } }, select: { id: true, name: true } }),
    prisma.jobCostEntry.findMany({ where: { jobId, jobItemId: { in: itemIds }, paidBy: { in: ['WORKER', 'SALARIED'] } }, select: { jobItemId: true, categoryId: true, tailorId: true, date: true } }),
  ])
  const before = (itemId: number, categoryId: number) => existing.find((e) => e.jobItemId === itemId && e.categoryId === categoryId)
  const person = (id: number | null, keepId: number | null | undefined) => {
    if (!id) return null
    const w = workers.find((x) => x.id === id)
    if (!w) throw ApiError.badRequest('Choose the worker again — reload the job')
    if (!w.isActive && w.id !== keepId) throw ApiError.badRequest(`${w.name} is inactive`)
    return w
  }

  const today = toDocDate(undefined).date
  const changes: string[] = []
  const itemUpdates: { id: number; tailorId: number | null; labourRate: number; labourNote: string | null }[] = []
  const entries: { jobItemId: number; categoryId: number; tailorId: number; date: Date; description: string | null; qty: number; rate: number; amount: number; paidBy: 'WORKER' | 'SALARIED' }[] = []
  for (const i of input.items) {
    const item = items.find((x) => x.id === i.id)
    if (!item) throw ApiError.badRequest('A garment line was not found — reload the job')
    const tailor = person(i.tailorId, item.tailorId)
    const labourRate = tailor?.payType === 'PIECE' ? i.labourRate : 0 // salaried: the salary covers it
    itemUpdates.push({ id: i.id, tailorId: tailor?.id ?? null, labourRate, labourNote: tailor ? i.labourNote : null })
    const parts = [`stitching ${tailor?.name ?? '—'}${labourRate ? ` ₹${labourRate}` : ''}`]
    if (new Set(i.works.map((w) => w.categoryId)).size !== i.works.length) throw ApiError.badRequest(`${item.description}: a work is listed twice`)
    for (const w of i.works) {
      const cat = categories.find((c) => c.id === w.categoryId)
      if (!cat) throw ApiError.badRequest('A work type no longer exists — reload the job')
      const old = before(i.id, w.categoryId)
      const by = person(w.tailorId, old?.tailorId)
      if (!by) continue // "not needed"
      const rate = by.payType === 'PIECE' ? w.rate : 0
      entries.push({ jobItemId: i.id, categoryId: cat.id, tailorId: by.id, date: old?.date ?? today, description: w.note, qty: item.qty, rate, amount: r2(item.qty * rate), paidBy: by.payType === 'PIECE' ? 'WORKER' : 'SALARIED' })
      parts.push(`${cat.name.toLowerCase()} ${by.name}${rate ? ` ₹${rate}` : ''}`)
    }
    changes.push(`${item.description}: ${parts.join(', ')}`)
  }

  await prisma.$transaction(async (tx) => {
    for (const u of itemUpdates) await tx.jobItem.update({ where: { id: u.id }, data: { tailorId: u.tailorId, labourRate: u.labourRate, labourNote: u.labourNote } })
    await tx.jobCostEntry.deleteMany({ where: { jobId, jobItemId: { in: itemUpdates.map((u) => u.id) }, paidBy: { in: ['WORKER', 'SALARIED'] } } })
    if (entries.length) await tx.jobCostEntry.createMany({ data: entries.map((e) => ({ ...e, jobId, createdBy: user })) })
    await audit(tx, { actor: user, action: 'job.workers', entity: 'job', entityId: jobId, summary: `${job.docNo}: ${changes.join('; ')}`.slice(0, 250) })
  })
  return getJob(jobId)
}
