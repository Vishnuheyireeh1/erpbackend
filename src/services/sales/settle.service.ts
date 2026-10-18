import { Prisma } from '../../generated/prisma/client'
import { audit } from '../audit.service'

// Money ↔ documents for a customer. Documents = sales bills (INV) and stitching jobs (JOB).
// Money = receipts (allocations) and return credit (credit allocations).
// Lock order everywhere: documents first, then money sources (avoids deadlocks).

type Tx = Prisma.TransactionClient
export type DocKind = 'INV' | 'JOB'
export type OpenDoc = { kind: DocKind; id: number; docNo: string; date: Date; due: number }

const r2 = (n: number) => Math.round(n * 100) / 100
export const targetOf = (kind: DocKind, id: number) => (kind === 'INV' ? { invoiceId: id } : { jobId: id })

// The customer's bills and jobs with something still due (locked), oldest first.
export async function openDocsTx(tx: Tx, customerId: number) {
  const [bills, jobs] = await Promise.all([
    tx.$queryRaw<{ id: number; doc_no: string; doc_date: Date; due: Prisma.Decimal }[]>`
      SELECT id, doc_no, doc_date, grand_total - paid_amount - returned_amount AS due FROM sales_invoices
      WHERE customer_id = ${customerId} AND status = 'POSTED' ORDER BY id FOR UPDATE`,
    tx.$queryRaw<{ id: number; doc_no: string; doc_date: Date; due: Prisma.Decimal }[]>`
      SELECT id, doc_no, doc_date, grand_total - paid_amount - returned_amount AS due FROM stitching_jobs
      WHERE customer_id = ${customerId} AND status <> 'CANCELLED' ORDER BY id FOR UPDATE`,
  ])
  const docs: OpenDoc[] = [
    ...bills.map((b) => ({ kind: 'INV' as const, id: b.id, docNo: b.doc_no, date: b.doc_date, due: Number(b.due) })),
    ...jobs.map((j) => ({ kind: 'JOB' as const, id: j.id, docNo: j.doc_no, date: j.doc_date, due: Number(j.due) })),
  ]
  return docs.sort((a, b) => a.date.getTime() - b.date.getTime() || (a.kind === b.kind ? a.id - b.id : a.kind === 'INV' ? -1 : 1))
}

export async function addPaidTx(tx: Tx, kind: DocKind, id: number, amount: number) {
  if (kind === 'INV') await tx.salesInvoice.update({ where: { id }, data: { paidAmount: { increment: amount } } })
  else await tx.stitchingJob.update({ where: { id }, data: { paidAmount: { increment: amount } } })
}

// Unused money of a customer: receipt advances + return credit (oldest first). lock = FOR UPDATE.
export async function advanceSources(tx: Tx, customerId: number, lock: boolean) {
  const forUpdate = lock ? Prisma.sql`FOR UPDATE` : Prisma.empty
  const receipts = await tx.$queryRaw<{ id: number; doc_no: string; free: Prisma.Decimal }[]>`
    SELECT r.id, r.doc_no, r.amount - COALESCE((SELECT SUM(a.amount) FROM receipt_allocations a WHERE a.receipt_id = r.id), 0) AS free
    FROM customer_receipts r WHERE r.customer_id = ${customerId} AND r.status = 'POSTED' ORDER BY r.doc_date, r.id ${forUpdate}`
  const credits = await tx.$queryRaw<{ id: number; doc_no: string; free: Prisma.Decimal }[]>`
    SELECT id, doc_no, grand_total - refund_amount - bill_cleared - credit_used AS free
    FROM sales_returns WHERE customer_id = ${customerId} AND status = 'POSTED' ORDER BY doc_date, id ${forUpdate}`
  const keep = (rows: { id: number; doc_no: string; free: Prisma.Decimal }[]) => rows.map((r) => ({ id: r.id, docNo: r.doc_no, free: Number(r.free) })).filter((r) => r.free > 0.004)
  const out = { receipts: keep(receipts), credits: keep(credits) }
  return { ...out, total: r2([...out.receipts, ...out.credits].reduce((s, r) => s + r.free, 0)) }
}

// Uses the customer's advance / credit on one bill or job (up to its due, and up to `max`). Returns the amount used.
export async function applyAdvanceTx(tx: Tx, customerId: number, kind: DocKind, id: number, user: string, max = Infinity) {
  const doc = (await openDocsTx(tx, customerId)).find((d) => d.kind === kind && d.id === id)
  if (!doc) return 0
  let left = r2(Math.min(doc.due, max))
  if (left <= 0.004) return 0
  const sources = await advanceSources(tx, customerId, true)
  const used: string[] = []
  for (const r of sources.receipts) {
    if (left <= 0.004) break
    const part = r2(Math.min(r.free, left))
    await tx.receiptAllocation.create({ data: { receiptId: r.id, ...targetOf(kind, id), amount: part } })
    used.push(`${r.docNo} ₹${part}`)
    left = r2(left - part)
  }
  for (const c of sources.credits) {
    if (left <= 0.004) break
    const part = r2(Math.min(c.free, left))
    await tx.creditAllocation.create({ data: { returnId: c.id, ...targetOf(kind, id), amount: part, createdBy: user } })
    await tx.salesReturn.update({ where: { id: c.id }, data: { creditUsed: { increment: part } } })
    used.push(`${c.docNo} credit ₹${part}`)
    left = r2(left - part)
  }
  const applied = r2(Math.min(doc.due, max) - left)
  if (applied > 0) {
    await addPaidTx(tx, kind, id, applied)
    await audit(tx, { actor: user, action: 'advance.apply', entity: kind === 'INV' ? 'sale' : 'job', entityId: id, summary: `${doc.docNo}: advance / credit used ₹${applied} (${used.join(', ')})` })
  }
  return applied
}

// A cancelled bill / job gives back what was paid on it: receipt money becomes advance again, credit returns to its return.
export async function releaseDocTx(tx: Tx, kind: DocKind, id: number, docNo: string, user: string) {
  const where = kind === 'INV' ? { invoiceId: id } : { jobId: id }
  const [allocs, credits] = await Promise.all([
    tx.receiptAllocation.findMany({ where: { ...where, receipt: { status: 'POSTED' } } }),
    tx.creditAllocation.findMany({ where }),
  ])
  for (const c of credits) await tx.salesReturn.update({ where: { id: c.returnId }, data: { creditUsed: { decrement: c.amount } } })
  await tx.receiptAllocation.deleteMany({ where: { id: { in: allocs.map((a) => a.id) } } })
  await tx.creditAllocation.deleteMany({ where: { id: { in: credits.map((c) => c.id) } } })
  const released = r2([...allocs, ...credits].reduce((s, a) => s + Number(a.amount), 0))
  if (released > 0) {
    await addPaidTx(tx, kind, id, -released)
    await audit(tx, { actor: user, action: 'advance.release', entity: kind === 'INV' ? 'sale' : 'job', entityId: id, summary: `${docNo} cancelled — ₹${released} paid on it is kept as the customer's advance / credit` })
  }
  return released
}
