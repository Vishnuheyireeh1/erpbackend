import { prisma } from '../../config/prisma'

// Own-made products (Workshop → Own-made products): how often each was made, pieces made, last date and the
// cost per piece of the latest making (used when nothing is in stock to average).

export type MakingStats = { timesMade: number; piecesMade: number; lastMade: Date | null; lastUnitCost: number | null }

export async function makingStats(productIds: number[]): Promise<Map<number, MakingStats>> {
  const stats = new Map<number, MakingStats>()
  if (!productIds.length) return stats
  const outputs = await prisma.productionOutput.findMany({
    where: { order: { status: 'POSTED' }, variant: { productId: { in: productIds } } },
    orderBy: [{ order: { docDate: 'asc' } }, { orderId: 'asc' }],
    select: { orderId: true, qty: true, unitCost: true, order: { select: { docDate: true } }, variant: { select: { productId: true } } },
  })
  const orders = new Map<number, Set<number>>()
  for (const o of outputs) {
    const id = o.variant.productId
    const s = stats.get(id) ?? { timesMade: 0, piecesMade: 0, lastMade: null, lastUnitCost: null }
    s.piecesMade += Number(o.qty)
    s.lastMade = o.order.docDate // ordered by date → the last one wins
    s.lastUnitCost = Number(o.unitCost)
    stats.set(id, s)
    orders.set(id, (orders.get(id) ?? new Set()).add(o.orderId))
  }
  for (const [id, set] of orders) stats.get(id)!.timesMade = set.size
  return stats
}
