import { byDate } from '../../utils/order'
import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import { dateRange, nextDocNo, toDocDate } from '../../utils/financialYear'
import type { ReceiptInput, Tender } from '../../validators/sales.validator'
import type { DocListQuery } from '../../validators/purchase.validator'
import { audit } from '../audit.service'
import { addPaidTx, openDocsTx, targetOf, type OpenDoc } from './settle.service'

const r2 = (n: number) => Math.round(n * 100) / 100

type Allocation = { invoiceId?: number; jobId?: number; amount: number }
type NewReceipt = {
  customerId: number | null
  docDate: Date
  tenders: Tender[]
  notes: string | null
  allocations?: Allocation[] // empty → oldest open bills / jobs first
}

const keyOf = (a: { invoiceId?: number | null; jobId?: number | null }) => (a.invoiceId ? `INV:${a.invoiceId}` : `JOB:${a.jobId}`)

// Open documents the money can go to (locked). Walk-in: only the bills named in the allocations.
async function lockTargets(tx: Prisma.TransactionClient, r: NewReceipt): Promise<OpenDoc[]> {
  if (r.customerId) return openDocsTx(tx, r.customerId)
  const ids = (r.allocations ?? []).map((a) => a.invoiceId).filter((x): x is number => !!x)
  const rows = await tx.$queryRaw<{ id: number; doc_no: string; doc_date: Date; due: Prisma.Decimal }[]>`
    SELECT id, doc_no, doc_date, grand_total - paid_amount - returned_amount AS due FROM sales_invoices
    WHERE id = ANY(${ids}) AND customer_id IS NULL AND status = 'POSTED' FOR UPDATE`
  return rows.map((b) => ({ kind: 'INV' as const, id: b.id, docNo: b.doc_no, date: b.doc_date, due: Number(b.due) }))
}

// Inside a transaction: lock the customer's open bills / jobs, allocate, save. Leftover = advance (customer only).
export async function createReceiptTx(tx: Prisma.TransactionClient, r: NewReceipt, user: string) {
  const amount = r2(r.tenders.reduce((s, t) => s + t.amount, 0))
  if (amount <= 0) throw ApiError.badRequest('Enter the amount received')
  const docs = new Map((await lockTargets(tx, r)).map((d) => [`${d.kind}:${d.id}`, d]))

  let allocations: Allocation[]
  if (r.allocations) {
    allocations = r.allocations
    for (const a of allocations) {
      const doc = docs.get(keyOf(a))
      if (!doc) throw ApiError.badRequest('A selected bill / job is not open for this customer')
      if (a.amount > doc.due + 0.004) throw ApiError.badRequest(`${doc.docNo}: only ₹${r2(doc.due)} is due`)
    }
  } else {
    let left = amount
    allocations = []
    for (const d of docs.values()) {
      if (left <= 0.004) break
      if (d.due <= 0.004) continue
      const part = r2(Math.min(left, d.due))
      allocations.push({ ...targetOf(d.kind, d.id), amount: part })
      left = r2(left - part)
    }
  }
  const allocated = r2(allocations.reduce((s, a) => s + a.amount, 0))
  if (allocated > amount + 0.004) throw ApiError.badRequest('Amounts against bills are more than the money received')
  if (!r.customerId && allocated < amount - 0.004) throw ApiError.badRequest('An advance needs a customer — choose the customer')

  const docNo = await nextDocNo(tx, 'RCP', r.docDate)
  const receipt = await tx.customerReceipt.create({
    data: { docNo, customerId: r.customerId, docDate: r.docDate, amount, notes: r.notes, createdBy: user, tenders: { create: r.tenders } },
  })
  for (const a of allocations) {
    await tx.receiptAllocation.create({ data: { receiptId: receipt.id, invoiceId: a.invoiceId ?? null, jobId: a.jobId ?? null, amount: a.amount } })
    await addPaidTx(tx, a.invoiceId ? 'INV' : 'JOB', (a.invoiceId ?? a.jobId)!, a.amount)
  }
  const advance = r2(amount - allocated)
  await audit(tx, {
    actor: user, action: 'receipt.post', entity: 'receipt', entityId: receipt.id,
    summary: `${docNo} ₹${amount} (${r.tenders.map((t) => `${t.mode} ${t.amount}`).join(' + ')})${advance > 0 ? `, advance ₹${advance}` : ''}`,
  })
  return receipt.id
}

export async function createReceipt(input: ReceiptInput, user: string) {
  const { date, isFuture } = toDocDate(input.docDate)
  if (isFuture) throw ApiError.badRequest("Date can't be in the future")
  const customer = await prisma.customer.findUnique({ where: { id: input.customerId } })
  if (!customer) throw ApiError.badRequest('Selected customer no longer exists')
  const id = await prisma.$transaction((tx) => createReceiptTx(tx, { ...input, docDate: date }, user))
  return getReceipt(id)
}

// Inside a transaction: mark cancelled and make the bills / jobs it paid due again.
export async function cancelReceiptTx(tx: Prisma.TransactionClient, id: number, reason: string, user: string) {
  const receipt = await tx.customerReceipt.findUnique({ where: { id }, include: { allocations: true } })
  if (!receipt) throw ApiError.notFound('Receipt not found')
  const done = await tx.customerReceipt.updateMany({
    where: { id, status: 'POSTED' },
    data: { status: 'CANCELLED', cancelledBy: user, cancelledAt: new Date(), cancelReason: reason },
  })
  if (done.count === 0) throw ApiError.conflict(`${receipt.docNo} is already cancelled`)
  for (const a of receipt.allocations) await addPaidTx(tx, a.invoiceId ? 'INV' : 'JOB', (a.invoiceId ?? a.jobId)!, -Number(a.amount))
  await audit(tx, { actor: user, action: 'receipt.cancel', entity: 'receipt', entityId: id, summary: `${receipt.docNo} cancelled — ${reason}` })
}

export async function cancelReceipt(id: number, reason: string, user: string) {
  await prisma.$transaction((tx) => cancelReceiptTx(tx, id, reason, user))
  return getReceipt(id)
}

export async function getReceipt(id: number) {
  const r = await prisma.customerReceipt.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, code: true, phone: true } },
      tenders: true,
      allocations: { include: { invoice: { select: { id: true, docNo: true, grandTotal: true } }, job: { select: { id: true, docNo: true, grandTotal: true } } } },
    },
  })
  if (!r) throw ApiError.notFound('Receipt not found')
  const allocated = r2(r.allocations.reduce((s, a) => s + Number(a.amount), 0))
  return { ...r, allocated, advance: r2(Number(r.amount) - allocated) }
}

export function receiptWhere(q: Omit<DocListQuery, 'page' | 'pageSize'> & { customerId?: number }) {
  const where: Prisma.CustomerReceiptWhereInput = {}
  if (q.customerId) where.customerId = q.customerId
  if (q.status === 'POSTED' || q.status === 'CANCELLED') where.status = q.status
  const range = dateRange(q.from, q.to)
  if (range) where.docDate = range
  if (q.search) where.OR = [{ docNo: { contains: q.search, mode: 'insensitive' } }, { customer: { name: { contains: q.search, mode: 'insensitive' } } }]
  return where
}

export async function listReceipts(q: DocListQuery & { customerId?: number }) {
  const where = receiptWhere(q)
  const [items, total] = await Promise.all([
    prisma.customerReceipt.findMany({ where, orderBy: byDate(q.order), skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { customer: { select: { id: true, name: true } }, tenders: true } }),
    prisma.customerReceipt.count({ where }),
  ])
  return { items, total, page: q.page, pageSize: q.pageSize }
}
