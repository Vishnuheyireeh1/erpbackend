import { prisma } from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import { toDocDate } from '../../utils/financialYear'
import type { BrandCostInput } from '../../validators/brandOrder.validator'
import { audit } from '../audit.service'

// Work and costs on a brand order besides the stitching pay (embroidery, hand work, cutting, outside work …):
//   WORKER   our per-piece worker → owed to them from the cost date (their statement, worker pay, books)
//   SALARIED salaried staff      → shown in the order profit only (their salary is the shop's cost)
//   PAID     money paid out      → day book + direct cost, from the cost date
// Profit of an order = billed (before GST) − our cloth − stitching pay (per piece) − these costs.

const r2 = (n: number) => Math.round(n * 100) / 100
const KIND: Record<string, string> = { WORKER: 'our worker', SALARIED: 'salaried staff', PAID: 'paid out' }

export async function addCost(orderId: number, input: BrandCostInput, user: string) {
  const order = await prisma.brandOrder.findUnique({ where: { id: orderId }, select: { docNo: true, status: true } })
  if (!order) throw ApiError.notFound('Brand order not found')
  if (order.status === 'CANCELLED') throw ApiError.conflict(`${order.docNo} is cancelled`)
  const [cat, worker, item] = await Promise.all([
    prisma.jobCostCategory.findUnique({ where: { id: input.categoryId } }),
    input.tailorId ? prisma.tailor.findUnique({ where: { id: input.tailorId }, select: { id: true, name: true, payType: true, isActive: true } }) : null,
    input.itemId ? prisma.brandOrderItem.findFirst({ where: { id: input.itemId, orderId }, select: { id: true } }) : null,
  ])
  if (!cat) throw ApiError.badRequest('Choose the work again')
  if (input.itemId && !item) throw ApiError.badRequest('That piece is not part of this order')
  if (input.paidBy === 'WORKER' && (!worker || worker.payType !== 'PIECE')) throw ApiError.badRequest('Choose the per-piece worker who did it (salaried people → "Salaried staff")')
  if (input.paidBy === 'PAID' && !input.mode) throw ApiError.badRequest('Choose how it was paid')
  const { date, isFuture } = toDocDate(input.date)
  if (isFuture) throw ApiError.badRequest("Date can't be in the future")
  const amount = r2(input.qty * input.rate)
  await prisma.$transaction(async (tx) => {
    await tx.brandOrderCost.create({
      data: {
        orderId, itemId: input.itemId ?? null, categoryId: cat.id, date, description: input.description, qty: input.qty, rate: input.rate, amount,
        paidBy: input.paidBy, mode: input.paidBy === 'PAID' ? input.mode : null, tailorId: worker?.id ?? null, createdBy: user,
      },
    })
    await audit(tx, { actor: user, action: 'brandOrder.cost.add', entity: 'brandOrder', entityId: orderId, summary: `${order.docNo}: ${cat.name} ₹${amount} (${KIND[input.paidBy]}${worker ? ` · ${worker.name}` : ''})` })
  })
}

export async function removeCost(orderId: number, costId: number, user: string) {
  const c = await prisma.brandOrderCost.findFirst({ where: { id: costId, orderId }, include: { order: { select: { docNo: true } }, category: { select: { name: true } } } })
  if (!c) throw ApiError.notFound('Cost line not found')
  await prisma.$transaction(async (tx) => {
    await tx.brandOrderCost.delete({ where: { id: costId } })
    await audit(tx, { actor: user, action: 'brandOrder.cost.remove', entity: 'brandOrder', entityId: orderId, summary: `${c.order.docNo}: removed ${c.category.name} ₹${c.amount} (${KIND[c.paidBy]})` })
  })
}

// Profit so far, per order: billed before GST, our cloth (stock cost), stitching pay of ready / delivered pieces, other costs.
export async function profitOf(ids: number[]) {
  const map = new Map<number, { billed: number; ourCloth: number; tailorPay: number; otherCosts: number; profit: number }>()
  if (!ids.length) return map
  const rows = await prisma.$queryRaw<{ id: number; billed: Prisma.Decimal | null; cloth: Prisma.Decimal | null; pay: Prisma.Decimal | null; other: Prisma.Decimal | null }[]>`
    SELECT o.id,
      (SELECT SUM(taxable_total) FROM brand_bills b WHERE b.order_id = o.id AND b.status = 'POSTED') AS billed,
      (SELECT -SUM(value) FROM stock_movements m WHERE m.ref_type = 'BRO' AND m.ref_id = o.id) AS cloth,
      (SELECT SUM(i.qty * i.labour_rate) FROM brand_order_items i JOIN tailors t ON t.id = i.tailor_id AND t.pay_type = 'PIECE'
        WHERE i.order_id = o.id AND i.stage <> 'IN_WORK') AS pay,
      (SELECT SUM(amount) FROM brand_order_costs c WHERE c.order_id = o.id) AS other
    FROM brand_orders o WHERE o.id = ANY(${ids})`
  for (const r of rows) {
    const v = { billed: r2(Number(r.billed ?? 0)), ourCloth: r2(Number(r.cloth ?? 0)), tailorPay: r2(Number(r.pay ?? 0)), otherCosts: r2(Number(r.other ?? 0)), profit: 0 }
    v.profit = r2(v.billed - v.ourCloth - v.tailorPay - v.otherCosts)
    map.set(r.id, v)
  }
  return map
}
