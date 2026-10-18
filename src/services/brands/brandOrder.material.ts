import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import { toDocDate } from '../../utils/financialYear'
import type { BrandMaterialInput } from '../../validators/brandOrder.validator'
import { audit } from '../audit.service'
import { postMovements } from '../inventory/stock.engine'
import { loadSaleItems } from '../sales/sale.rules'
import { getSetting } from '../settings.service'
import { lockOpenOrder } from './brandOrder.rules'

// Cloth / lining from OUR stock for a brand piece. Leaves stock at once (ref BRO): charged lines = cost of goods
// (billed to the brand with the piece), free lines = material used for the stitching. The brand's own cloth is not stock.

type Tx = Prisma.TransactionClient
const TX = { timeout: 30_000, maxWait: 20_000 }
const r2 = (n: number) => Math.round(n * 100) / 100

export async function priceMaterials(lines: BrandMaterialInput[]) {
  if (!lines.length) return []
  const items = await loadSaleItems(lines.map((l) => l.variantId))
  return lines.map((l) => {
    const item = items.get(l.variantId)!
    if (item.isService && !l.charged) throw ApiError.badRequest(`${item.description} is a service — it can only be charged`)
    const amount = l.charged ? r2(l.qty * l.rate * (1 - l.discountPct / 100)) : 0
    return { variantId: l.variantId, description: item.description, hsnCode: item.hsnCode, qty: l.qty, charged: l.charged, rate: l.charged ? l.rate : 0, discountPct: l.charged ? l.discountPct : 0, amount, isService: item.isService }
  })
}
export type PricedMaterial = Awaited<ReturnType<typeof priceMaterials>>[number]

export async function postMaterialsTx(tx: Tx, order: { id: number; docNo: string }, itemId: number, lines: PricedMaterial[], ctx: { user: string; date: Date; allowNegative: boolean }) {
  if (!lines.length) return
  const goods = lines.map((l, i) => ({ l, i })).filter(({ l }) => !l.isService)
  const moved = await postMovements(
    tx,
    goods.map(({ l }) => ({ variantId: l.variantId, qty: -l.qty, type: l.charged ? ('SALE' as const) : ('JOB_CONSUMPTION' as const), note: `${l.charged ? 'Charged on' : 'Used for'} ${order.docNo}` })),
    { refType: 'BRO', refId: order.id, refNo: order.docNo, date: ctx.date, user: ctx.user, allowNegative: ctx.allowNegative },
  )
  const cost = new Map(goods.map(({ i }, k) => [i, moved[k].unitCost]))
  await tx.brandOrderMaterial.createMany({
    data: lines.map(({ isService: _s, ...l }, i) => ({ ...l, orderId: order.id, itemId, unitCost: cost.get(i) ?? 0, createdBy: ctx.user })),
  })
}

// Materials back to stock (piece removed, material taken off, order cancelled) — reversing the same books line
// (charged → cost of goods, free → material used).
export async function returnMaterialsTx(tx: Tx, order: { id: number; docNo: string }, materialIds: number[], ctx: { user: string; note: string }) {
  if (!materialIds.length) return
  const rows = await tx.brandOrderMaterial.findMany({ where: { id: { in: materialIds }, orderId: order.id } })
  const allowNegative = await getSetting('inventory.allowNegativeStock')
  // Services never left stock, so nothing goes back for them.
  const services = new Set((await tx.productVariant.findMany({ where: { id: { in: rows.map((m) => m.variantId) }, product: { type: 'SERVICE' } }, select: { id: true } })).map((v) => v.id))
  await postMovements(
    tx,
    rows.filter((m) => !services.has(m.variantId)).map((m) => ({ variantId: m.variantId, qty: Number(m.qty), unitCost: Number(m.unitCost), type: m.charged ? ('SALE_RETURN' as const) : ('CANCELLATION' as const), note: ctx.note })),
    { refType: 'BRO', refId: order.id, refNo: order.docNo, date: toDocDate(undefined).date, user: ctx.user, allowNegative },
  )
  await tx.brandOrderMaterial.deleteMany({ where: { id: { in: rows.map((m) => m.id) } } })
}

// Order page: add stock items to a piece that is not delivered yet.
export async function addMaterials(orderId: number, itemId: number, input: BrandMaterialInput[], user: string) {
  const lines = await priceMaterials(input)
  const allowNegative = await getSetting('inventory.allowNegativeStock')
  await prisma.$transaction(async (tx) => {
    const order = await lockOpenOrder(tx, orderId)
    const item = await tx.brandOrderItem.findFirst({ where: { id: itemId, orderId } })
    if (!item) throw ApiError.notFound('Piece not found')
    if (item.stage === 'DELIVERED') throw ApiError.conflict(`${item.description} is already delivered`)
    await postMaterialsTx(tx, order, itemId, lines, { user, date: toDocDate(undefined).date, allowNegative })
    await audit(tx, { actor: user, action: 'brandOrder.material.add', entity: 'brandOrder', entityId: orderId, summary: `${order.docNo} · ${item.description}: ${lines.map((l) => `${l.qty} × ${l.description}${l.charged ? ` ₹${l.amount}` : ' (free)'}`).join(', ')}`.slice(0, 250) })
  }, TX)
}

export async function removeMaterial(orderId: number, materialId: number, user: string) {
  await prisma.$transaction(async (tx) => {
    const order = await lockOpenOrder(tx, orderId)
    const m = await tx.brandOrderMaterial.findFirst({ where: { id: materialId, orderId }, include: { item: { select: { stage: true, description: true } } } })
    if (!m) throw ApiError.notFound('Item line not found')
    if (m.item.stage === 'DELIVERED') throw ApiError.conflict(`${m.item.description} is already delivered — its items can't be taken off`)
    await returnMaterialsTx(tx, order, [m.id], { user, note: `Taken off ${order.docNo}` })
    await audit(tx, { actor: user, action: 'brandOrder.material.remove', entity: 'brandOrder', entityId: orderId, summary: `${order.docNo}: ${m.qty} × ${m.description} back to stock` })
  }, TX)
}
