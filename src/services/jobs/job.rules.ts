import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import type { JobItemInput } from '../../validators/job.validator'
import { calcJob, materialForCalc } from './job.calc'

type Tx = Prisma.TransactionClient
const r2 = (n: number) => Math.round(n * 100) / 100

// Garments and tailors used on a job must exist; NEW lines need active ones.
export async function loadRefs(items: JobItemInput[], existingIds: Set<number> = new Set()) {
  const garmentIds = [...new Set(items.map((i) => i.garmentTypeId))]
  const tailorIds = [...new Set(items.map((i) => i.tailorId).filter((x): x is number => !!x))]
  const [garments, tailors] = await Promise.all([
    prisma.garmentType.findMany({ where: { id: { in: garmentIds } }, select: { id: true, name: true, isActive: true } }),
    prisma.tailor.findMany({ where: { id: { in: tailorIds } }, select: { id: true, name: true, isActive: true } }),
  ])
  const g = new Map(garments.map((x) => [x.id, x]))
  const t = new Map(tailors.map((x) => [x.id, x]))
  for (const i of items) {
    const garment = g.get(i.garmentTypeId)
    if (!garment) throw ApiError.badRequest('A garment type on the job no longer exists')
    if (!garment.isActive && !(i.id && existingIds.has(i.id))) throw ApiError.badRequest(`${garment.name} is inactive`)
    if (i.tailorId) {
      const tailor = t.get(i.tailorId)
      if (!tailor) throw ApiError.badRequest('A tailor on the job no longer exists')
      if (!tailor.isActive && !(i.id && existingIds.has(i.id))) throw ApiError.badRequest(`Tailor ${tailor.name} is inactive`)
    }
  }
  return { garmentName: (id: number) => g.get(id)!.name }
}

// Job row locked for the rest of the transaction; only open jobs can change.
export async function lockOpenJob(tx: Tx, id: number) {
  const [row] = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM stitching_jobs WHERE id = ${id} FOR UPDATE`
  if (!row) throw ApiError.notFound('Job not found')
  const job = await tx.stitchingJob.findUniqueOrThrow({ where: { id } })
  if (job.status === 'DELIVERED') throw ApiError.conflict(`${job.docNo} is already handed over — make an alteration job instead`)
  if (job.status === 'CANCELLED') throw ApiError.conflict(`${job.docNo} is cancelled`)
  return job
}

// Recalculates the job's totals from its lines. The total can't drop below what is already paid.
export async function recalcJobTx(tx: Tx, id: number) {
  const job = await tx.stitchingJob.findUniqueOrThrow({ where: { id }, include: { items: true, materials: true, costs: true } })
  const calc = calcJob({
    items: job.items.map((i) => ({ qty: i.qty, chargeRate: Number(i.chargeRate), labourRate: Number(i.labourRate) })),
    materials: job.materials.map(materialForCalc),
    costs: job.costs.map((c) => ({ charge: Number(c.charge) })),
    discount: Number(job.discount),
    gstRate: Number(job.gstRate),
    taxMode: job.taxMode,
  })
  if (calc.grandTotal < Number(job.paidAmount) - 0.004) {
    throw ApiError.badRequest(`The new total ₹${calc.grandTotal} is less than the ₹${r2(Number(job.paidAmount))} already paid — cancel a receipt first`)
  }
  const { cost: _cost, itemsTotal: _items, ...totals } = calc
  await tx.stitchingJob.update({ where: { id }, data: totals })
  return calc
}

// Item rows for create / update (measurements are the copy taken now).
export function itemData(i: JobItemInput, index: number, garmentName: (id: number) => string) {
  return {
    garmentTypeId: i.garmentTypeId,
    description: i.description ?? garmentName(i.garmentTypeId),
    qty: i.qty,
    chargeRate: i.chargeRate,
    tailorId: i.tailorId,
    labourRate: i.labourRate,
    measurements: i.measurements,
    instructions: i.instructions,
    ownFabric: i.ownFabric,
    sortOrder: index,
  }
}
