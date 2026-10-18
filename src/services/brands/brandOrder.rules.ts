import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import type { BrandPieceInput } from '../../validators/brandOrder.validator'

type Tx = Prisma.TransactionClient

// Garments and tailors on a brand order must exist; NEW pieces need active ones. Salaried tailors get no per-piece pay.
export async function loadPieceRefs(items: BrandPieceInput[], existingIds: Set<number> = new Set()) {
  const garmentIds = [...new Set(items.map((i) => i.garmentTypeId))]
  const tailorIds = [...new Set(items.map((i) => i.tailorId).filter((x): x is number => !!x))]
  const [garments, tailors] = await Promise.all([
    prisma.garmentType.findMany({ where: { id: { in: garmentIds } }, select: { id: true, name: true, isActive: true } }),
    prisma.tailor.findMany({ where: { id: { in: tailorIds } }, select: { id: true, name: true, isActive: true, payType: true } }),
  ])
  const g = new Map(garments.map((x) => [x.id, x]))
  const t = new Map(tailors.map((x) => [x.id, x]))
  for (const i of items) {
    const old = !!i.id && existingIds.has(i.id)
    const garment = g.get(i.garmentTypeId)
    if (!garment) throw ApiError.badRequest('A garment type on the order no longer exists')
    if (!garment.isActive && !old) throw ApiError.badRequest(`${garment.name} is inactive`)
    if (i.tailorId) {
      const tailor = t.get(i.tailorId)
      if (!tailor) throw ApiError.badRequest('A tailor on the order no longer exists')
      if (!tailor.isActive && !old) throw ApiError.badRequest(`Tailor ${tailor.name} is inactive`)
    }
  }
  return {
    garmentName: (id: number) => g.get(id)!.name,
    payFor: (i: BrandPieceInput) => (i.tailorId && t.get(i.tailorId)?.payType === 'PIECE' ? i.labourRate : 0),
  }
}
export type PieceRefs = Awaited<ReturnType<typeof loadPieceRefs>>

// Columns of one piece row (create / update).
export function pieceData(i: BrandPieceInput, sortOrder: number, refs: PieceRefs) {
  return {
    garmentTypeId: i.garmentTypeId,
    description: i.description || refs.garmentName(i.garmentTypeId),
    endCustomer: i.endCustomer,
    qty: i.qty,
    chargeRate: i.chargeRate,
    brandCloth: i.brandCloth,
    measurements: i.measurements,
    instructions: i.instructions,
    tailorId: i.tailorId,
    labourRate: refs.payFor(i),
    sortOrder,
  }
}

// Order row locked for the rest of the transaction; only open orders change.
export async function lockOpenOrder(tx: Tx, id: number) {
  const [row] = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM brand_orders WHERE id = ${id} FOR UPDATE`
  if (!row) throw ApiError.notFound('Brand order not found')
  const order = await tx.brandOrder.findUniqueOrThrow({ where: { id } })
  if (order.status === 'COMPLETED') throw ApiError.conflict(`${order.docNo} is fully delivered`)
  if (order.status === 'CANCELLED') throw ApiError.conflict(`${order.docNo} is cancelled`)
  return order
}
