import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import { toDocDate, todayIST } from '../../utils/financialYear'
import { taxModeFor } from '../../utils/gst'
import type { SaleInput } from '../../validators/sales.validator'
import { audit } from '../audit.service'
import { postMovements } from '../inventory/stock.engine'
import { getSetting } from '../settings.service'
import { createReceiptTx } from './receipt.service'
import { applyAdvanceTx, releaseDocTx } from './settle.service'
import { calcSale } from './sales.calc'
import { getSale } from './sale.query'
import { loadSaleItems, splitTenders } from './sale.rules'

// Edit a shop bill and keep its number. Allowed only in the month of the bill (GST of earlier months may already be
// filed) and before any return. The old lines go back to stock and the new ones go out; totals, GST and cost are worked
// out again; money already paid stays on the bill (a named customer's extra becomes advance; a walk-in must still be
// paid in full). The old version is kept in the activity log.

const TX = { timeout: 60_000, maxWait: 20_000 }
const r2 = (n: number) => Math.round(n * 100) / 100
const month = (d: string) => d.slice(0, 7)

export async function editSale(id: number, input: SaleInput, user: string) {
  const bill = await prisma.salesInvoice.findUnique({ where: { id }, include: { lines: true } })
  if (!bill) throw ApiError.notFound('Sales bill not found')
  if (bill.status !== 'POSTED') throw ApiError.conflict(`${bill.docNo} is cancelled`)
  if (month(bill.docDate.toISOString()) !== month(todayIST())) throw ApiError.conflict(`${bill.docNo} is from an earlier month — its GST may be filed. Return the items or cancel it instead`)
  if (await prisma.salesReturn.count({ where: { invoiceId: id, status: 'POSTED' } })) throw ApiError.conflict(`${bill.docNo} has returns — it can't be edited`)
  if ((input.customerId ?? null) !== bill.customerId) throw ApiError.badRequest("The customer of a bill can't be changed — cancel it and make a new bill")
  const { date, isFuture } = toDocDate(input.docDate ?? bill.docDate.toISOString().slice(0, 10))
  if (isFuture) throw ApiError.badRequest("Bill date can't be in the future")
  if (month(date.toISOString()) !== month(todayIST())) throw ApiError.badRequest('The bill date must stay in this month')

  const customer = bill.customerId ? await prisma.customer.findUnique({ where: { id: bill.customerId } }) : null
  const items = await loadSaleItems(input.lines.map((l) => l.variantId))
  const [profile, apparelRule, allowNegative] = await Promise.all([getSetting('business.profile'), getSetting('billing.apparelGstRule'), getSetting('inventory.allowNegativeStock')])
  const taxMode = taxModeFor(profile.stateCode, customer?.stateCode)
  const calc = calcSale({
    lines: input.lines.map((l) => ({ ...l, productGstRate: items.get(l.variantId)!.gstRate, hsnCode: items.get(l.variantId)!.hsnCode })),
    billDiscount: input.billDiscount, taxMode, gstRegistered: profile.gstRegistered, apparelRule,
  })
  const paidBefore = Number(bill.paidAmount)
  const pay = splitTenders(input.tenders, Math.max(0, r2(calc.grandTotal - paidBefore)))
  if (!customer) {
    if (calc.grandTotal < paidBefore - 0.004) throw ApiError.badRequest(`New total ₹${calc.grandTotal} is less than the ₹${paidBefore} paid — for a walk-in, return the items instead`)
    if (paidBefore + pay.applied < calc.grandTotal - 0.004) throw ApiError.badRequest(`₹${r2(calc.grandTotal - paidBefore - pay.applied)} more is due — a walk-in bill must be paid in full`)
  }

  await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM sales_invoices WHERE id = ${id} FOR UPDATE`
    if (row?.status !== 'POSTED') throw ApiError.conflict(`${bill.docNo} was just cancelled`)
    const services = new Set((await tx.productVariant.findMany({ where: { id: { in: [...bill.lines.map((l) => l.variantId), ...input.lines.map((l) => l.variantId)] }, product: { type: 'SERVICE' } }, select: { id: true } })).map((v) => v.id))
    const ref = { refType: 'INV', refId: id, refNo: bill.docNo, date, user, allowNegative }
    // Old lines back to stock at their own cost, then the new lines out at today's average.
    await postMovements(tx, bill.lines.filter((l) => !services.has(l.variantId)).map((l) => ({ variantId: l.variantId, qty: Number(l.qty), unitCost: Number(l.unitCost), type: 'CANCELLATION' as const, note: `Edited ${bill.docNo}` })), ref)
    const goods = input.lines.map((l, i) => ({ l, i })).filter(({ l }) => !services.has(l.variantId))
    const moved = await postMovements(tx, goods.map(({ l }) => ({ variantId: l.variantId, qty: -l.qty, type: 'SALE' as const, note: `Edited ${bill.docNo}` })), ref)
    const unitCost = new Map(goods.map(({ i }, k) => [i, moved[k].unitCost]))
    await tx.salesLine.deleteMany({ where: { invoiceId: id } })
    await tx.salesLine.createMany({
      data: input.lines.map((l, i) => {
        const item = items.get(l.variantId)!
        const c = calc.lines[i]
        return {
          invoiceId: id, variantId: l.variantId, description: item.description, hsnCode: item.hsnCode, qty: l.qty, rate: l.rate, discountPct: l.discountPct,
          amount: c.amount, gstRate: c.gstRate, taxable: c.taxable, cgst: c.cgst, sgst: c.sgst, igst: c.igst, unitCost: unitCost.get(i) ?? 0,
        }
      }),
    })
    const costTotal = r2(input.lines.reduce((s, l, i) => s + (unitCost.get(i) ?? 0) * l.qty, 0))
    await tx.salesInvoice.update({
      where: { id },
      data: {
        docDate: date, taxMode, grossTotal: calc.grossTotal, discountTotal: calc.discountTotal, taxableTotal: calc.taxableTotal, cgstTotal: calc.cgstTotal,
        sgstTotal: calc.sgstTotal, igstTotal: calc.igstTotal, roundOff: calc.roundOff, grandTotal: calc.grandTotal, notes: input.notes ?? null, bookNo: input.bookNo ?? null, costTotal,
      },
    })
    // Paid more than the new total (customer): the extra goes back to their advance.
    if (customer && calc.grandTotal < paidBefore - 0.004) {
      await releaseDocTx(tx, 'INV', id, bill.docNo, user)
      await applyAdvanceTx(tx, customer.id, 'INV', id, user, calc.grandTotal)
    } else if (customer && input.useAdvance) await applyAdvanceTx(tx, customer.id, 'INV', id, user)
    if (pay.applied > 0) {
      await createReceiptTx(tx, { customerId: customer?.id ?? null, docDate: date, tenders: pay.tenders, notes: `With ${bill.docNo} (edited)`, allocations: [{ invoiceId: id, amount: pay.applied }] }, user)
    }
    const before = bill.lines.map((l) => `${Number(l.qty)} × ${l.description} @ ${Number(l.rate)}`).join(', ')
    await audit(tx, {
      actor: user, action: 'sale.edit', entity: 'sale', entityId: id,
      summary: `${bill.docNo} edited — total ₹${Number(bill.grandTotal)} → ₹${calc.grandTotal}`.slice(0, 250),
      details: { before: { total: Number(bill.grandTotal), lines: before, discount: Number(bill.discountTotal) }, after: { total: calc.grandTotal, lines: input.lines.map((l) => `${l.qty} × ${items.get(l.variantId)!.description} @ ${l.rate}`).join(', ') } },
    })
  }, TX)
  return getSale(id)
}
