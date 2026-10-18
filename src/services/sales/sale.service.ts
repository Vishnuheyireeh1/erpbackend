import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import { nextDocNo, toDocDate } from '../../utils/financialYear'
import { taxModeFor } from '../../utils/gst'
import type { SaleInput } from '../../validators/sales.validator'
import { audit } from '../audit.service'
import { postMovements } from '../inventory/stock.engine'
import { getSetting } from '../settings.service'
import { cancelReceiptTx, createReceiptTx } from './receipt.service'
import { applyAdvanceTx, releaseDocTx } from './settle.service'
import { calcSale } from './sales.calc'
import { getSale } from './sale.query'
import { loadSaleItems, splitTenders } from './sale.rules'

const TX = { timeout: 60_000, maxWait: 20_000 }

// Saves a sales bill: stock OUT (not for services), cost captured for profit, money received, change worked out.
export async function createSale(input: SaleInput, user: string) {
  const { date, isFuture } = toDocDate(input.docDate)
  if (isFuture) throw ApiError.badRequest("Bill date can't be in the future")
  const customer = input.customerId ? await prisma.customer.findUnique({ where: { id: input.customerId } }) : null
  if (input.customerId && !customer) throw ApiError.badRequest('Selected customer no longer exists')
  if (customer && !customer.isActive) throw ApiError.badRequest(`Customer "${customer.name}" is inactive`)

  const items = await loadSaleItems(input.lines.map((l) => l.variantId))
  const [profile, apparelRule, allowNegative] = await Promise.all([
    getSetting('business.profile'), getSetting('billing.apparelGstRule'), getSetting('inventory.allowNegativeStock'),
  ])
  const taxMode = taxModeFor(profile.stateCode, customer?.stateCode)
  const calc = calcSale({
    lines: input.lines.map((l) => ({ ...l, productGstRate: items.get(l.variantId)!.gstRate, hsnCode: items.get(l.variantId)!.hsnCode })),
    billDiscount: input.billDiscount, taxMode, gstRegistered: profile.gstRegistered, apparelRule,
  })
  // Counter bills (readymade / materials) are always paid in full — only stitching jobs keep a balance.
  // A customer's advance / return credit counts as payment (checked inside the transaction, after it is applied).
  const fullError = (due: number) => ApiError.badRequest(`₹${Math.round(due * 100) / 100} is still due — readymade / material bills must be paid in full`)
  if (!customer || !input.useAdvance) {
    const pay = splitTenders(input.tenders, calc.grandTotal)
    if (pay.applied < calc.grandTotal - 0.004) throw fullError(calc.grandTotal - pay.applied)
  }

  const id = await prisma.$transaction(async (tx) => {
    const docNo = await nextDocNo(tx, 'SALE', date)
    const bill = await tx.salesInvoice.create({
      data: {
        docNo, customerId: customer?.id ?? null, docDate: date, taxMode,
        customerName: customer?.name ?? input.walkInName ?? 'Cash customer',
        customerPhone: customer?.phone ?? input.walkInPhone, customerGstin: customer?.gstin ?? null,
        grossTotal: calc.grossTotal, discountTotal: calc.discountTotal, taxableTotal: calc.taxableTotal,
        cgstTotal: calc.cgstTotal, sgstTotal: calc.sgstTotal, igstTotal: calc.igstTotal, roundOff: calc.roundOff,
        grandTotal: calc.grandTotal, notes: input.notes, bookNo: input.bookNo, createdBy: user,
      },
    })
    // Stock out for goods (services like stitching charges have no stock); cost = average at the time.
    const goods = input.lines.map((l, i) => ({ l, i })).filter(({ l }) => !items.get(l.variantId)!.isService)
    const applied = await postMovements(
      tx,
      goods.map(({ l }) => ({ variantId: l.variantId, qty: -l.qty, type: 'SALE' as const })),
      { refType: 'INV', refId: bill.id, refNo: docNo, date, user, allowNegative },
    )
    const unitCost = new Map(goods.map(({ i }, k) => [i, applied[k].unitCost]))
    await tx.salesLine.createMany({
      data: input.lines.map((l, i) => {
        const item = items.get(l.variantId)!
        const c = calc.lines[i]
        return {
          invoiceId: bill.id, variantId: l.variantId, description: item.description, hsnCode: item.hsnCode, qty: l.qty, rate: l.rate,
          discountPct: l.discountPct, amount: c.amount, gstRate: c.gstRate, taxable: c.taxable, cgst: c.cgst, sgst: c.sgst, igst: c.igst,
          unitCost: unitCost.get(i) ?? 0,
        }
      }),
    })
    const costTotal = input.lines.reduce((s, l, i) => s + (unitCost.get(i) ?? 0) * l.qty, 0)
    // Advance / credit first, then the money handed over now (change only from cash).
    const advance = customer && input.useAdvance ? await applyAdvanceTx(tx, customer.id, 'INV', bill.id, user) : 0
    const pay = splitTenders(input.tenders, Math.round((calc.grandTotal - advance) * 100) / 100)
    if (advance + pay.applied < calc.grandTotal - 0.004) throw fullError(calc.grandTotal - advance - pay.applied)
    await tx.salesInvoice.update({ where: { id: bill.id }, data: { costTotal: Math.round(costTotal * 100) / 100, cashTendered: pay.cashTendered, changeReturned: pay.change } })
    if (pay.applied > 0) {
      await createReceiptTx(tx, { customerId: customer?.id ?? null, docDate: date, tenders: pay.tenders, notes: `With ${docNo}`, allocations: [{ invoiceId: bill.id, amount: pay.applied }] }, user)
    }
    await audit(tx, { actor: user, action: 'sale.post', entity: 'sale', entityId: bill.id, summary: `${docNo} — ${bill.customerName}, ₹${calc.grandTotal}, paid ₹${pay.applied}${advance ? `, advance used ₹${advance}` : ''}` })
    return bill.id
  }, TX)
  return getSale(id)
}

// Cancel = stock back in at the same cost. Walk-in: the money taken is handed back (its receipts are cancelled).
// Customer: what was paid on the bill stays as their advance (cancel the receipt too if the cash was given back).
export async function cancelSale(id: number, reason: string, user: string) {
  const bill = await prisma.salesInvoice.findUnique({ where: { id }, include: { lines: true, allocations: { include: { receipt: true } } } })
  if (!bill) throw ApiError.notFound('Sales bill not found')
  if (bill.status === 'CANCELLED') throw ApiError.conflict(`${bill.docNo} is already cancelled`)
  if (await prisma.salesReturn.count({ where: { invoiceId: id, status: 'POSTED' } })) throw ApiError.conflict(`${bill.docNo} has returns — cancel those first`)
  const walkInReceipts = bill.customerId ? [] : bill.allocations.filter((a) => a.receipt.status === 'POSTED').map((a) => a.receipt)
  const allowNegative = await getSetting('inventory.allowNegativeStock')

  await prisma.$transaction(async (tx) => {
    for (const r of walkInReceipts) await cancelReceiptTx(tx, r.id, `Bill ${bill.docNo} cancelled: ${reason}`, user)
    if (bill.customerId) await releaseDocTx(tx, 'INV', id, bill.docNo, user)
    const done = await tx.salesInvoice.updateMany({ where: { id, status: 'POSTED' }, data: { status: 'CANCELLED', cancelledBy: user, cancelledAt: new Date(), cancelReason: reason } })
    if (done.count === 0) throw ApiError.conflict(`${bill.docNo} is already cancelled`)
    // Services never left stock, so only goods come back.
    const services = await tx.productVariant.findMany({ where: { id: { in: bill.lines.map((l) => l.variantId) }, product: { type: 'SERVICE' } }, select: { id: true } })
    const serviceIds = new Set(services.map((s) => s.id))
    await postMovements(
      tx,
      bill.lines.filter((l) => !serviceIds.has(l.variantId)).map((l) => ({ variantId: l.variantId, qty: Number(l.qty), unitCost: Number(l.unitCost), type: 'CANCELLATION' as const, note: `Cancelled ${bill.docNo}: ${reason}` })),
      { refType: 'INV', refId: bill.id, refNo: bill.docNo, date: toDocDate(undefined).date, user, allowNegative },
    )
    await audit(tx, { actor: user, action: 'sale.cancel', entity: 'sale', entityId: id, summary: `${bill.docNo} cancelled — ${reason}` })
  }, TX)
  return getSale(id)
}
