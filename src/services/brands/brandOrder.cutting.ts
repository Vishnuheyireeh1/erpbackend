import type { Prisma } from '../../generated/prisma/client'
import type { BrandPieceInput } from '../../validators/brandOrder.validator'
import type { PieceRefs } from './brandOrder.rules'

type Tx = Prisma.TransactionClient
type Piece = { id: number; qty: number }

// Cutting master of a piece, picked on the brand order form (under the tailor). Kept as the piece's "Cutting" work line
// (brand_order_costs), so it shows in the order's Work & costs, its profit and the worker's balance like any other work:
//   per-piece worker → WORKER line: pieces × their pay (owed to them)
//   salaried          → SALARIED line at ₹0 (only who did it — their salary is the shop's cost)
// The form edits ONE cutting line per piece (the first one with a worker); more can still be added on the order page.

const r2 = (n: number) => Math.round(n * 100) / 100

async function cuttingWork(tx: Tx) {
  const found = await tx.jobCostCategory.findFirst({ where: { name: { equals: 'Cutting', mode: 'insensitive' } } })
  return found ?? tx.jobCostCategory.create({ data: { name: 'Cutting', defaultPaidBy: 'SALARIED' } })
}

export async function syncCutting(tx: Tx, order: { id: number; docDate: Date }, piece: Piece, cutting: BrandPieceInput['cutting'], refs: PieceRefs, user: string) {
  const work = await cuttingWork(tx)
  const line = await tx.brandOrderCost.findFirst({ where: { itemId: piece.id, categoryId: work.id, tailorId: { not: null } }, orderBy: { id: 'asc' } })
  if (!cutting) {
    if (line) await tx.brandOrderCost.delete({ where: { id: line.id } })
    return
  }
  const perPiece = refs.worker(cutting.tailorId).payType === 'PIECE'
  const rate = perPiece ? cutting.rate : 0
  const data = {
    qty: piece.qty, rate, amount: r2(piece.qty * rate), paidBy: perPiece ? ('WORKER' as const) : ('SALARIED' as const), tailorId: cutting.tailorId,
  }
  if (line) await tx.brandOrderCost.update({ where: { id: line.id }, data })
  else await tx.brandOrderCost.create({ data: { ...data, orderId: order.id, itemId: piece.id, categoryId: work.id, date: order.docDate, description: 'Cutting master', createdBy: user } })
}

// Pieces taken off the order: their cutting line goes too (else it would stay as an order cost with no piece).
export async function dropCutting(tx: Tx, itemIds: number[]) {
  if (!itemIds.length) return
  const work = await cuttingWork(tx)
  await tx.brandOrderCost.deleteMany({ where: { itemId: { in: itemIds }, categoryId: work.id, tailorId: { not: null } } })
}
