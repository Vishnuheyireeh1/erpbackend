import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import { toDocDate } from '../../utils/financialYear'
import type { FreightPaidInput } from '../../validators/purchase.validator'
import { audit } from '../audit.service'
import { getPurchase } from './purchase.query'

// Freight paid separately to the transporter ("To pay" on the lorry receipt). It is part of the items' stock cost
// (never on the supplier's bill); this records WHEN and HOW the transporter was paid → cash / bank goes down
// (day book "Freight paid") and the "Freight payable" in accounts clears. Can be set at billing or later.

export async function markFreightPaid(id: number, input: FreightPaidInput, user: string) {
  const bill = await prisma.purchaseInvoice.findUnique({ where: { id }, select: { docNo: true, status: true, docDate: true, freightSeparate: true, freightMode: true } })
  if (!bill) throw ApiError.notFound('Purchase bill not found')
  if (bill.status === 'CANCELLED') throw ApiError.conflict(`${bill.docNo} is cancelled`)
  if (!(Number(bill.freightSeparate) > 0)) throw ApiError.badRequest('This bill has no freight paid separately')
  if (bill.freightMode) throw ApiError.conflict('Freight on this bill is already marked paid')
  const { date, isFuture } = toDocDate(input.date)
  if (isFuture) throw ApiError.badRequest("Date can't be in the future")
  if (date < bill.docDate) throw ApiError.badRequest("Freight can't be paid before the bill date")
  await prisma.$transaction(async (tx) => {
    await tx.purchaseInvoice.update({ where: { id }, data: { freightMode: input.mode, freightPaidOn: date, freightPaidAt: new Date() } })
    await audit(tx, { actor: user, action: 'purchase.freight_paid', entity: 'purchase_invoice', entityId: id, summary: `${bill.docNo}: freight ₹${bill.freightSeparate} paid (${input.mode})` })
  })
  return getPurchase(id)
}
