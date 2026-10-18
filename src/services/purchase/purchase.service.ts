import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import { nextDocNo, toDocDate } from '../../utils/financialYear'
import { taxModeFor } from '../../utils/gst'
import type { PurchaseInput } from '../../validators/purchase.validator'
import { audit } from '../audit.service'
import { postMovements } from '../inventory/stock.engine'
import { getSetting } from '../settings.service'
import { createPaymentTx } from './payment.service'
import { calcPurchase } from './purchase.calc'
import { getPurchase } from './purchase.query'

const TX = { timeout: 120_000, maxWait: 20_000 }

function checkDates(input: PurchaseInput) {
  const bill = toDocDate(input.supplierInvoiceDate)
  const received = toDocDate(input.docDate)
  if (bill.isFuture) throw ApiError.badRequest("Supplier bill date can't be in the future")
  if (received.isFuture) throw ApiError.badRequest("Received date can't be in the future")
  return { billDate: bill.date, docDate: received.date }
}

// Saves a purchase bill: stock IN at landed cost, optional payment, all in one transaction.
export async function createPurchase(input: PurchaseInput, user: string) {
  const { billDate, docDate } = checkDates(input)
  const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId } })
  if (!supplier) throw ApiError.badRequest('Selected supplier no longer exists')
  if (!supplier.isActive) throw ApiError.badRequest(`Supplier "${supplier.name}" is inactive`)

  const dup = await prisma.purchaseInvoice.findFirst({
    where: { supplierId: supplier.id, supplierInvoiceNo: { equals: input.supplierInvoiceNo, mode: 'insensitive' }, status: 'POSTED' },
  })
  if (dup) throw ApiError.conflict(`Bill ${input.supplierInvoiceNo} from ${supplier.name} is already entered (${dup.docNo})`)

  const [profile, allowNegative] = await Promise.all([getSetting('business.profile'), getSetting('inventory.allowNegativeStock')])
  const taxMode = taxModeFor(profile.stateCode, supplier.stateCode)
  const calc = calcPurchase({ ...input, taxMode, gstRegistered: profile.gstRegistered })
  if (input.payNow && input.payNow.amount > calc.grandTotal) {
    throw ApiError.badRequest(`Paid now (₹${input.payNow.amount}) is more than the bill total (₹${calc.grandTotal})`)
  }

  const id = await prisma.$transaction(async (tx) => {
    const docNo = await nextDocNo(tx, 'PUR', docDate)
    const bill = await tx.purchaseInvoice.create({
      data: {
        docNo, supplierId: supplier.id, supplierInvoiceNo: input.supplierInvoiceNo, supplierInvoiceDate: billDate, docDate,
        taxMode, taxableTotal: calc.taxableTotal, cgstTotal: calc.cgstTotal, sgstTotal: calc.sgstTotal, igstTotal: calc.igstTotal,
        otherCharges: calc.otherCharges, chargesGstRate: input.chargesGstRate, chargesTax: calc.chargesTax,
        billDiscount: calc.billDiscount, billDiscountPct: input.billDiscountPct, freightSeparate: input.freightSeparate, freightNote: input.freightNote,
        ...(input.freightSeparate > 0 && input.freightMode ? { freightMode: input.freightMode, freightPaidOn: docDate, freightPaidAt: new Date() } : {}),
        roundOff: calc.roundOff, grandTotal: calc.grandTotal, notes: input.notes, createdBy: user,
      },
    })
    await tx.purchaseLine.createMany({
      data: input.lines.map((l, i) => ({ invoiceId: bill.id, ...l, ...calc.lines[i], tax: undefined })),
    })
    await postMovements(
      tx,
      input.lines.map((l, i) => ({ variantId: l.variantId, qty: l.qty, unitCost: calc.lines[i].unitCost, type: 'PURCHASE' })),
      { refType: 'PUR', refId: bill.id, refNo: docNo, date: docDate, user, allowNegative },
    )
    // Remember the latest purchase price (after discount) on each item.
    for (const [i, l] of input.lines.entries()) {
      await tx.productVariant.update({ where: { id: l.variantId }, data: { purchasePrice: Math.round((calc.lines[i].taxable / l.qty) * 100) / 100 } })
    }
    if (input.payNow) {
      await createPaymentTx(tx, { supplierId: supplier.id, docDate, amount: input.payNow.amount, mode: input.payNow.mode, reference: input.payNow.reference ?? null, notes: `Paid with ${docNo}`, allocations: [{ invoiceId: bill.id, amount: input.payNow.amount }] }, user)
    }
    await audit(tx, { actor: user, action: 'purchase.post', entity: 'purchase', entityId: bill.id, summary: `${docNo} — ${supplier.name} bill ${input.supplierInvoiceNo}, ₹${calc.grandTotal}` })
    return bill.id
  }, TX)
  return getPurchase(id)
}

// Cancel = reverse the stock. Blocked while payments or returns are attached (cancel those first).
export async function cancelPurchase(id: number, reason: string, user: string) {
  const bill = await prisma.purchaseInvoice.findUnique({ where: { id }, include: { lines: true } })
  if (!bill) throw ApiError.notFound('Purchase bill not found')
  if (bill.status === 'CANCELLED') throw ApiError.conflict(`${bill.docNo} is already cancelled`)
  if (Number(bill.paidAmount) > 0) throw ApiError.conflict(`${bill.docNo} has payments — cancel those payments first`)
  if (Number(bill.returnedAmount) > 0) throw ApiError.conflict(`${bill.docNo} has purchase returns — cancel those returns first`)
  const allowNegative = await getSetting('inventory.allowNegativeStock')

  await prisma.$transaction(async (tx) => {
    const done = await tx.purchaseInvoice.updateMany({
      where: { id, status: 'POSTED', paidAmount: 0, returnedAmount: 0 },
      data: { status: 'CANCELLED', cancelledBy: user, cancelledAt: new Date(), cancelReason: reason },
    })
    if (done.count === 0) throw ApiError.conflict(`${bill.docNo} changed meanwhile — reload and try again`)
    await postMovements(
      tx,
      bill.lines.map((l) => ({ variantId: l.variantId, qty: -Number(l.qty), unitCost: Number(l.unitCost), type: 'CANCELLATION', note: `Cancelled ${bill.docNo}: ${reason}` })),
      { refType: 'PUR', refId: bill.id, refNo: bill.docNo, date: toDocDate(undefined).date, user, allowNegative },
    )
    await audit(tx, { actor: user, action: 'purchase.cancel', entity: 'purchase', entityId: id, summary: `${bill.docNo} cancelled — ${reason}` })
  }, TX).catch((err) => {
    if (err instanceof ApiError && err.message.startsWith('Not enough stock')) {
      throw ApiError.conflict(`Can't cancel ${bill.docNo} — some of these items are already sold or used. ${err.message}`)
    }
    throw err
  })
  return getPurchase(id)
}
