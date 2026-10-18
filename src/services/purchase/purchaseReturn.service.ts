import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import { nextDocNo, toDocDate } from '../../utils/financialYear'
import type { PurchaseReturnInput } from '../../validators/purchase.validator'
import { audit } from '../audit.service'
import { postMovements } from '../inventory/stock.engine'
import { getSetting } from '../settings.service'

const r2 = (n: number) => Math.round(n * 100) / 100
const TX = { timeout: 60_000 }

// Debit note: goods back to the supplier → stock OUT at the original purchase cost; the bill's due drops.
export async function createReturn(input: PurchaseReturnInput, user: string) {
  const { date, isFuture } = toDocDate(input.docDate)
  if (isFuture) throw ApiError.badRequest("Return date can't be in the future")
  const bill = await prisma.purchaseInvoice.findUnique({ where: { id: input.invoiceId }, include: { lines: true } })
  if (!bill) throw ApiError.notFound('Purchase bill not found')
  if (bill.status !== 'POSTED') throw ApiError.badRequest(`${bill.docNo} is cancelled`)
  const allowNegative = await getSetting('inventory.allowNegativeStock')

  const byId = new Map(bill.lines.map((l) => [l.id, l]))
  const seen = new Set<number>()
  const lines = input.lines.map((r) => {
    const line = byId.get(r.purchaseLineId)
    if (!line) throw ApiError.badRequest('A returned item is not on this bill')
    if (seen.has(line.id)) throw ApiError.badRequest('The same bill line is listed twice')
    seen.add(line.id)
    const left = Number(line.qty) - Number(line.returnedQty)
    if (r.qty > left + 0.0005) throw ApiError.badRequest(`Only ${left} of this item can still be returned`)
    const share = r.qty / Number(line.qty)
    const taxable = r2(Number(line.taxable) * share)
    const tax = r2((Number(line.cgst) + Number(line.sgst) + Number(line.igst)) * share)
    return { line, qty: r.qty, taxable, tax, total: r2(taxable + tax) }
  })
  const taxableTotal = r2(lines.reduce((s, l) => s + l.taxable, 0))
  const taxTotal = r2(lines.reduce((s, l) => s + l.tax, 0))
  const grandTotal = r2(taxableTotal + taxTotal)

  const id = await prisma.$transaction(async (tx) => {
    const docNo = await nextDocNo(tx, 'DN', date)
    const ret = await tx.purchaseReturn.create({
      data: { docNo, supplierId: bill.supplierId, invoiceId: bill.id, docDate: date, reason: input.reason, taxableTotal, taxTotal, grandTotal, createdBy: user },
    })
    await tx.purchaseReturnLine.createMany({
      data: lines.map((l) => ({ returnId: ret.id, purchaseLineId: l.line.id, variantId: l.line.variantId, qty: l.qty, taxable: l.taxable, tax: l.tax, total: l.total, unitCost: l.line.unitCost })),
    })
    await postMovements(
      tx,
      lines.map((l) => ({ variantId: l.line.variantId, qty: -l.qty, unitCost: Number(l.line.unitCost), type: 'PURCHASE_RETURN', note: input.reason })),
      { refType: 'DN', refId: ret.id, refNo: docNo, date, user, allowNegative },
    )
    // Conditional update = the database itself refuses returning more than was bought (safe with two users at once).
    for (const l of lines) {
      const ok = await tx.$executeRaw`
        UPDATE purchase_lines SET returned_qty = returned_qty + ${l.qty}::numeric
        WHERE id = ${l.line.id} AND returned_qty + ${l.qty}::numeric <= qty`
      if (ok === 0) throw ApiError.conflict('Another return was saved for this bill meanwhile — reload and try again')
    }
    await tx.purchaseInvoice.update({ where: { id: bill.id }, data: { returnedAmount: { increment: grandTotal } } })
    await audit(tx, { actor: user, action: 'purchase_return.post', entity: 'purchase_return', entityId: ret.id, summary: `${docNo} against ${bill.docNo} — ₹${grandTotal}` })
    return ret.id
  }, TX)
  return getReturn(id)
}

// Cancel = items come back into stock at the same cost; the bill's due goes up again.
export async function cancelReturn(id: number, reason: string, user: string) {
  const ret = await prisma.purchaseReturn.findUnique({ where: { id }, include: { lines: true } })
  if (!ret) throw ApiError.notFound('Purchase return not found')
  if (ret.status === 'CANCELLED') throw ApiError.conflict(`${ret.docNo} is already cancelled`)
  const allowNegative = await getSetting('inventory.allowNegativeStock')
  await prisma.$transaction(async (tx) => {
    const done = await tx.purchaseReturn.updateMany({
      where: { id, status: 'POSTED' },
      data: { status: 'CANCELLED', cancelledBy: user, cancelledAt: new Date(), cancelReason: reason },
    })
    if (done.count === 0) throw ApiError.conflict(`${ret.docNo} is already cancelled`)
    await postMovements(
      tx,
      ret.lines.map((l) => ({ variantId: l.variantId, qty: Number(l.qty), unitCost: Number(l.unitCost), type: 'CANCELLATION', note: `Cancelled ${ret.docNo}: ${reason}` })),
      { refType: 'DN', refId: ret.id, refNo: ret.docNo, date: toDocDate(undefined).date, user, allowNegative },
    )
    for (const l of ret.lines) await tx.purchaseLine.update({ where: { id: l.purchaseLineId }, data: { returnedQty: { decrement: l.qty } } })
    await tx.purchaseInvoice.update({ where: { id: ret.invoiceId }, data: { returnedAmount: { decrement: ret.grandTotal } } })
    await audit(tx, { actor: user, action: 'purchase_return.cancel', entity: 'purchase_return', entityId: id, summary: `${ret.docNo} cancelled — ${reason}` })
  }, TX)
  return getReturn(id)
}

export async function getReturn(id: number) {
  const ret = await prisma.purchaseReturn.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, code: true } },
      invoice: { select: { id: true, docNo: true, supplierInvoiceNo: true } },
      lines: { orderBy: { id: 'asc' } },
    },
  })
  if (!ret) throw ApiError.notFound('Purchase return not found')
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: ret.lines.map((l) => l.variantId) } },
    select: { id: true, sku: true, size: { select: { name: true } }, colour: { select: { name: true } }, product: { select: { name: true, unit: { select: { code: true } } } } },
  })
  const v = new Map(variants.map((x) => [x.id, x]))
  return { ...ret, lines: ret.lines.map((l) => ({ ...l, variant: v.get(l.variantId)! })) }
}
