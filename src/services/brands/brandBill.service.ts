import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import { nextDocNo, toDocDate } from '../../utils/financialYear'
import { taxModeFor } from '../../utils/gst'
import type { BrandDeliverInput } from '../../validators/brandBill.validator'
import { audit } from '../audit.service'
import { getSetting } from '../settings.service'
import { getBill } from './brandBill.query'
import { lockOpenOrder } from './brandOrder.rules'

// Delivery bill (BD/…): the pieces handed over to the brand now + items from our stock charged with them.
// Rates are GST-inclusive (like customer bills); the GST % is chosen on the bill. The brand owes the bill total.

const TX = { timeout: 30_000, maxWait: 20_000 }
const r2 = (n: number) => Math.round(n * 100) / 100

// GST inside a GST-inclusive amount; whole-rupee total with the paise as round off.
export function billTotals(gross: number, gstRate: number, taxMode: 'INTRA' | 'INTER') {
  const taxable = gstRate > 0 ? r2(gross / (1 + gstRate / 100)) : r2(gross)
  const tax = r2(gross - taxable)
  const cgst = taxMode === 'INTRA' ? r2(tax / 2) : 0
  const grandTotal = Math.round(gross)
  return { grossTotal: r2(gross), taxableTotal: taxable, cgstTotal: cgst, sgstTotal: taxMode === 'INTRA' ? r2(tax - cgst) : 0, igstTotal: taxMode === 'INTER' ? tax : 0, roundOff: r2(grandTotal - gross), grandTotal }
}

export async function deliver(orderId: number, input: BrandDeliverInput, user: string) {
  const { date, isFuture } = toDocDate(input.docDate)
  if (isFuture) throw ApiError.badRequest("Bill date can't be in the future")
  const profile = await getSetting('business.profile')
  if (input.gstRate > 0 && !profile.gstRegistered) throw ApiError.badRequest('The shop is not GST registered — choose "No GST"')

  const billId = await prisma.$transaction(async (tx) => {
    const order = await lockOpenOrder(tx, orderId)
    const brand = await tx.partnerBrand.findUniqueOrThrow({ where: { id: order.brandId } })
    const items = await tx.brandOrderItem.findMany({ where: { orderId, id: { in: input.itemIds } }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { materials: { where: { charged: true }, include: { variant: { select: { product: { select: { unit: { select: { code: true } } } } } } } } } })
    if (items.length !== new Set(input.itemIds).size) throw ApiError.badRequest('A piece is not part of this order — reload the page')
    const done = items.find((i) => i.stage === 'DELIVERED')
    if (done) throw ApiError.badRequest(`${done.description}${done.endCustomer ? ` (${done.endCustomer})` : ''} is already delivered`)

    let k = 0
    const lines = items.flatMap((i) => [
      { kind: 'PIECE', description: i.description, endCustomer: i.endCustomer, qty: i.qty, unit: 'NOS', rate: Number(i.chargeRate), amount: r2(i.qty * Number(i.chargeRate)), sortOrder: k++ },
      ...i.materials.map((m) => ({ kind: 'ITEM', description: m.description, endCustomer: null, qty: Number(m.qty), unit: m.variant.product.unit.code.toUpperCase().slice(0, 10), rate: Number(m.rate), amount: Number(m.amount), sortOrder: k++ })),
    ])
    const taxMode = taxModeFor(profile.stateCode, brand.stateCode)
    const totals = billTotals(lines.reduce((s, l) => s + l.amount, 0), input.gstRate, taxMode)
    const docNo = await nextDocNo(tx, 'BD', date)
    const bill = await tx.brandBill.create({
      data: {
        docNo, orderId, brandId: brand.id, brandName: brand.name, brandGstin: brand.gstin, docDate: date, taxMode, gstRate: input.gstRate,
        ...totals, notes: input.notes, createdBy: user, lines: { create: lines },
      },
    })
    // Delivered pieces: on this bill; a piece never marked Ready counts as ready today (tailor pay earned).
    for (const i of items) await tx.brandOrderItem.update({ where: { id: i.id }, data: { stage: 'DELIVERED', billId: bill.id, readyOn: i.readyOn ?? date } })
    const left = await tx.brandOrderItem.count({ where: { orderId, stage: { not: 'DELIVERED' } } })
    if (!left) await tx.brandOrder.update({ where: { id: orderId }, data: { status: 'COMPLETED' } })
    const pieces = items.reduce((s, i) => s + i.qty, 0)
    await audit(tx, { actor: user, action: 'brandBill.create', entity: 'brandBill', entityId: bill.id, summary: `${docNo} — ${brand.name}, ${order.docNo}: ${pieces} piece(s), ₹${totals.grandTotal}${input.gstRate ? ` incl. ${input.gstRate}% GST` : ''}${left ? '' : ' — order fully delivered'}` })
    return bill.id
  }, TX)
  return getBill(billId)
}

// Cancel a bill: its pieces go back to Ready (not delivered), the order opens again, the brand no longer owes it.
export async function cancelBill(id: number, reason: string, user: string) {
  await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM brand_bills WHERE id = ${id} FOR UPDATE`
    if (!row) throw ApiError.notFound('Bill not found')
    const bill = await tx.brandBill.findUniqueOrThrow({ where: { id }, include: { order: { select: { status: true, docNo: true } } } })
    if (bill.status === 'CANCELLED') throw ApiError.conflict(`${bill.docNo} is already cancelled`)
    if (bill.order.status === 'CANCELLED') throw ApiError.conflict(`${bill.order.docNo} is cancelled`)
    await tx.brandOrderItem.updateMany({ where: { billId: id }, data: { stage: 'READY', billId: null } })
    await tx.brandOrder.update({ where: { id: bill.orderId }, data: { status: 'OPEN' } })
    await tx.brandBill.update({ where: { id }, data: { status: 'CANCELLED', cancelledBy: user, cancelledAt: new Date(), cancelReason: reason } })
    await audit(tx, { actor: user, action: 'brandBill.cancel', entity: 'brandBill', entityId: id, summary: `${bill.docNo} cancelled (₹${bill.grandTotal}) — ${reason}; pieces back to Ready` })
  }, TX)
  return getBill(id)
}
