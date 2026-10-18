import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import { nextDocNo, toDocDate } from '../../utils/financialYear'
import type { ProductionInput } from '../../validators/production.validator'
import { audit } from '../audit.service'
import { postMovements } from '../inventory/stock.engine'
import { getSetting } from '../settings.service'
import { getProduction } from './production.query'

// Production entry (PRD/…): materials OUT at average cost, finished pieces IN at
// (materials + per-piece tailor labour + costs paid out) ÷ pieces. Salaried time = costing info only.
// Never edited — cancel reverses the stock (blocked if the finished pieces are already sold).

const r2 = (n: number) => Math.round(n * 100) / 100
const r4 = (n: number) => Math.round(n * 10000) / 10000
const TX = { timeout: 60_000 }

async function checkInput(input: ProductionInput) {
  const outIds = input.outputs.map((o) => o.variantId)
  const matIds = input.materials.map((m) => m.variantId)
  if (new Set(outIds).size !== outIds.length) throw ApiError.badRequest('A finished item is listed twice — add the quantities together')
  if (new Set(matIds).size !== matIds.length) throw ApiError.badRequest('A material is listed twice — add the quantities together')
  if (outIds.some((id) => matIds.includes(id))) throw ApiError.badRequest("An item can't be both a material and a finished piece")
  const variants = await prisma.productVariant.findMany({ where: { id: { in: [...outIds, ...matIds] } }, select: { id: true, sku: true, product: { select: { name: true, type: true } } } })
  if (variants.length !== new Set([...outIds, ...matIds]).size) throw ApiError.badRequest('An item no longer exists — reload and try again')
  const service = variants.find((v) => v.product.type === 'SERVICE')
  if (service) throw ApiError.badRequest(`${service.product.name} is a service — it has no stock`)

  const tailorIds = [...new Set(input.costs.filter((c) => c.kind === 'TAILOR').map((c) => c.tailorId!))]
  const tailors = await prisma.tailor.findMany({ where: { id: { in: tailorIds } }, select: { id: true, name: true, isActive: true, payType: true } })
  for (const id of tailorIds) {
    const t = tailors.find((x) => x.id === id)
    if (!t || !t.isActive) throw ApiError.badRequest('Choose an active tailor')
    if (t.payType !== 'PIECE') throw ApiError.badRequest(`${t.name} is on salary — add the work as "Salaried staff" instead`)
  }
}

export async function createProduction(input: ProductionInput, user: string) {
  const { date, isFuture } = toDocDate(input.docDate)
  if (isFuture) throw ApiError.badRequest("Date can't be in the future")
  await checkInput(input)
  const allowNegative = await getSetting('inventory.allowNegativeStock')

  const costs = input.costs.map((c, i) => ({
    kind: c.kind, description: c.description, sortOrder: i, reference: c.reference,
    tailorId: c.kind === 'TAILOR' ? c.tailorId! : null,
    qty: c.kind === 'TAILOR' ? c.qty! : null,
    rate: c.kind === 'TAILOR' ? c.rate! : null,
    amount: c.kind === 'TAILOR' ? r2(c.qty! * c.rate!) : r2(c.amount!),
    mode: c.kind === 'PAID' ? c.mode! : null,
  }))
  const sum = (k: string) => r2(costs.filter((c) => c.kind === k).reduce((s, c) => s + c.amount, 0))
  const labourCost = sum('TAILOR'), paidCost = sum('PAID'), salariedCost = sum('SALARIED')
  if (costs.some((c) => c.amount <= 0)) throw ApiError.badRequest('Every making cost needs an amount above 0')
  const pieces = input.outputs.reduce((s, o) => s + o.qty, 0)

  const id = await prisma.$transaction(async (tx) => {
    // Lock every item (lowest id first, like the stock engine) so the material cost can't change under us.
    const ids = [...new Set([...input.outputs, ...input.materials].map((l) => l.variantId))]
    const locked = await tx.$queryRaw<{ id: number; avg_cost: Prisma.Decimal }[]>`SELECT id, avg_cost FROM product_variants WHERE id = ANY(${ids}) ORDER BY id FOR UPDATE`
    const avg = new Map(locked.map((v) => [v.id, Number(v.avg_cost)]))
    const materialCost = r2(input.materials.reduce((s, m) => s + m.qty * r4(avg.get(m.variantId)!), 0))
    const stockCost = r2(materialCost + labourCost + paidCost)
    const unitCost = r4(stockCost / pieces)

    const docNo = await nextDocNo(tx, 'PRD', date)
    const order = await tx.productionOrder.create({
      data: { docNo, docDate: date, title: input.title, notes: input.notes, pieces, materialCost, labourCost, paidCost, salariedCost, stockCost, createdBy: user },
    })
    const ctx = { refType: 'PRD', refId: order.id, refNo: docNo, date, user, allowNegative }
    const moved = await postMovements(tx, [
      ...input.materials.map((m) => ({ variantId: m.variantId, qty: -m.qty, unitCost: avg.get(m.variantId), type: 'PRODUCTION_OUT' as const, note: `Used in ${docNo}` })),
      ...input.outputs.map((o) => ({ variantId: o.variantId, qty: o.qty, unitCost, type: 'PRODUCTION_IN' as const, note: `Made in ${docNo}` })),
    ], ctx)
    const n = input.materials.length
    await tx.productionMaterial.createMany({ data: input.materials.map((m, i) => ({ orderId: order.id, variantId: m.variantId, qty: m.qty, unitCost: moved[i].unitCost, sortOrder: i })) })
    await tx.productionOutput.createMany({ data: input.outputs.map((o, i) => ({ orderId: order.id, variantId: o.variantId, qty: o.qty, unitCost: moved[n + i].unitCost, sortOrder: i })) })
    if (costs.length) await tx.productionCost.createMany({ data: costs.map((c) => ({ ...c, orderId: order.id })) })
    await audit(tx, {
      actor: user, action: 'production.post', entity: 'production', entityId: order.id,
      summary: `${docNo}${input.title ? ` ${input.title}` : ''}: ${pieces} pieces, cost ₹${stockCost} (₹${unitCost}/piece)`,
    })
    return order.id
  }, TX)
  return getProduction(id)
}

export async function cancelProduction(id: number, reason: string, user: string) {
  const order = await prisma.productionOrder.findUnique({ where: { id }, include: { outputs: true, materials: true } })
  if (!order) throw ApiError.notFound('Production entry not found')
  if (order.status === 'CANCELLED') throw ApiError.conflict(`${order.docNo} is already cancelled`)
  const allowNegative = await getSetting('inventory.allowNegativeStock')
  const today = toDocDate(undefined).date

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.productionOrder.updateMany({ where: { id, status: 'POSTED' }, data: { status: 'CANCELLED', cancelledBy: user, cancelledAt: new Date(), cancelReason: reason } })
    if (fresh.count === 0) throw ApiError.conflict(`${order.docNo} is already cancelled`)
    const note = `Cancelled ${order.docNo}: ${reason}`
    // Finished pieces go back out (at their own cost); materials come back in (at the cost they left at).
    await postMovements(tx, [
      ...order.outputs.map((o) => ({ variantId: o.variantId, qty: -Number(o.qty), unitCost: Number(o.unitCost), type: 'CANCELLATION' as const, note })),
      ...order.materials.map((m) => ({ variantId: m.variantId, qty: Number(m.qty), unitCost: Number(m.unitCost), type: 'CANCELLATION' as const, note })),
    ], { refType: 'PRD', refId: id, refNo: order.docNo, date: today, user, allowNegative })
    await audit(tx, { actor: user, action: 'production.cancel', entity: 'production', entityId: id, summary: `${order.docNo} cancelled — ${reason}` })
  }, TX).catch((err) => {
    if (err instanceof ApiError && err.message.startsWith('Not enough stock')) {
      throw ApiError.conflict(`Can't cancel ${order.docNo} — some finished pieces are already sold. ${err.message}`)
    }
    throw err
  })
  return getProduction(id)
}
