import { byDate } from '../../utils/order'
import { prisma } from '../../config/prisma'
import type { PaymentMode, Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import { dateRange, nextDocNo, toDocDate } from '../../utils/financialYear'
import type { DocListQuery, PaymentInput } from '../../validators/purchase.validator'
import { audit } from '../audit.service'

const r2 = (n: number) => Math.round(n * 100) / 100

type NewPayment = {
  supplierId: number
  docDate: Date
  amount: number
  mode: PaymentMode
  reference: string | null
  notes: string | null
  allocations?: { invoiceId: number; amount: number }[]
}

// Inside a transaction: lock the supplier's bills, allocate, save. Leftover = advance (on account).
export async function createPaymentTx(tx: Prisma.TransactionClient, p: NewPayment, user: string) {
  const bills = await tx.$queryRaw<{ id: number; doc_no: string; due: Prisma.Decimal }[]>`
    SELECT id, doc_no, grand_total - paid_amount - returned_amount AS due
    FROM purchase_invoices
    WHERE supplier_id = ${p.supplierId} AND status = 'POSTED'
    ORDER BY doc_date, id
    FOR UPDATE`
  const due = new Map(bills.map((b) => [b.id, { docNo: b.doc_no, due: Number(b.due) }]))

  let allocations = p.allocations
  if (allocations) {
    for (const a of allocations) {
      const bill = due.get(a.invoiceId)
      if (!bill) throw ApiError.badRequest('A selected bill is not an open bill of this supplier')
      if (a.amount > bill.due + 0.004) throw ApiError.badRequest(`${bill.docNo}: only ₹${r2(bill.due)} is due`)
    }
    const allocated = allocations.reduce((s, a) => s + a.amount, 0)
    if (allocated > p.amount + 0.004) throw ApiError.badRequest('Amounts against bills are more than the payment')
  } else {
    // Oldest unpaid bill first.
    let left = p.amount
    allocations = []
    for (const [invoiceId, b] of due) {
      if (left <= 0.004) break
      if (b.due <= 0.004) continue
      const amount = r2(Math.min(left, b.due))
      allocations.push({ invoiceId, amount })
      left = r2(left - amount)
    }
  }

  const docNo = await nextDocNo(tx, 'PAY', p.docDate)
  const payment = await tx.supplierPayment.create({
    data: { docNo, supplierId: p.supplierId, docDate: p.docDate, amount: p.amount, mode: p.mode, reference: p.reference, notes: p.notes, createdBy: user },
  })
  for (const a of allocations) {
    await tx.paymentAllocation.create({ data: { paymentId: payment.id, invoiceId: a.invoiceId, amount: a.amount } })
    await tx.purchaseInvoice.update({ where: { id: a.invoiceId }, data: { paidAmount: { increment: a.amount } } })
  }
  const advance = r2(p.amount - allocations.reduce((s, a) => s + a.amount, 0))
  await audit(tx, {
    actor: user,
    action: 'supplier_payment.post',
    entity: 'supplier_payment',
    entityId: payment.id,
    summary: `${docNo} ₹${p.amount} by ${p.mode} — ${allocations.length} bill(s)${advance > 0 ? `, advance ₹${advance}` : ''}`,
  })
  return payment.id
}

export async function createPayment(input: PaymentInput, user: string) {
  const { date, isFuture } = toDocDate(input.docDate)
  if (isFuture) throw ApiError.badRequest("Payment date can't be in the future")
  const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId } })
  if (!supplier) throw ApiError.badRequest('Selected supplier no longer exists')
  const id = await prisma.$transaction((tx) => createPaymentTx(tx, { ...input, docDate: date }, user))
  return getPayment(id)
}

// Cancel = the bills it paid become due again.
export async function cancelPayment(id: number, reason: string, user: string) {
  const payment = await prisma.supplierPayment.findUnique({ where: { id }, include: { allocations: true } })
  if (!payment) throw ApiError.notFound('Payment not found')
  if (payment.status === 'CANCELLED') throw ApiError.conflict(`${payment.docNo} is already cancelled`)
  await prisma.$transaction(async (tx) => {
    const done = await tx.supplierPayment.updateMany({
      where: { id, status: 'POSTED' },
      data: { status: 'CANCELLED', cancelledBy: user, cancelledAt: new Date(), cancelReason: reason },
    })
    if (done.count === 0) throw ApiError.conflict(`${payment.docNo} is already cancelled`)
    for (const a of payment.allocations) {
      await tx.purchaseInvoice.update({ where: { id: a.invoiceId }, data: { paidAmount: { decrement: a.amount } } })
    }
    await audit(tx, { actor: user, action: 'supplier_payment.cancel', entity: 'supplier_payment', entityId: id, summary: `${payment.docNo} cancelled — ${reason}` })
  })
  return getPayment(id)
}

export async function getPayment(id: number) {
  const p = await prisma.supplierPayment.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, code: true } },
      allocations: { include: { invoice: { select: { id: true, docNo: true, supplierInvoiceNo: true, grandTotal: true } } } },
    },
  })
  if (!p) throw ApiError.notFound('Payment not found')
  const allocated = r2(p.allocations.reduce((s, a) => s + Number(a.amount), 0))
  return { ...p, allocated, advance: r2(Number(p.amount) - allocated) }
}

// Same filters for the list screen and the Excel download.
export function paymentWhere(q: Omit<DocListQuery, 'page' | 'pageSize'>) {
  const where: Prisma.SupplierPaymentWhereInput = {}
  if (q.supplierId) where.supplierId = q.supplierId
  if (q.status === 'POSTED' || q.status === 'CANCELLED') where.status = q.status
  const range = dateRange(q.from, q.to)
  if (range) where.docDate = range
  if (q.search) {
    where.OR = [
      { docNo: { contains: q.search, mode: 'insensitive' } },
      { reference: { contains: q.search, mode: 'insensitive' } },
      { supplier: { name: { contains: q.search, mode: 'insensitive' } } },
    ]
  }
  return where
}

export async function listPayments(q: DocListQuery) {
  const where = paymentWhere(q)
  const [items, total] = await Promise.all([
    prisma.supplierPayment.findMany({
      where,
      orderBy: byDate(q.order),
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { supplier: { select: { id: true, name: true } } },
    }),
    prisma.supplierPayment.count({ where }),
  ])
  return { items, total, page: q.page, pageSize: q.pageSize }
}
