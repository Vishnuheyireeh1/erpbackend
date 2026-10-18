import { prisma } from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import type { DocListQuery } from '../../validators/purchase.validator'

// Sales → "All bills": shop bills (INV/…) and stitching job bills (JOB/…) in ONE list, filterable by kind.
// Same filters for the screen and the Excel download.

export type BillKind = 'all' | 'SHOP' | 'JOB'
export type BillFilters = Omit<DocListQuery, 'page' | 'pageSize'> & { customerId?: number; kind?: BillKind }
type Row = {
  kind: 'SHOP' | 'JOB'; id: number; doc_no: string; book_no: string | null; doc_date: Date; customer_id: number | null; customer_name: string; customer_phone: string | null
  taxable: Prisma.Decimal; gst: Prisma.Decimal; grand_total: Prisma.Decimal; paid_amount: Prisma.Decimal; returned_amount: Prisma.Decimal; cancelled: boolean; stage: string | null; lines: number
}

const BILLS = Prisma.sql`(
  SELECT 'SHOP' AS kind, s.id, s.doc_no, s.book_no, s.doc_date, s.customer_id, s.customer_name, s.customer_phone, s.taxable_total AS taxable,
    s.cgst_total + s.sgst_total + s.igst_total AS gst, s.grand_total, s.paid_amount, s.returned_amount, s.status = 'CANCELLED' AS cancelled,
    NULL::text AS stage, (SELECT count(*)::int FROM sales_lines l WHERE l.invoice_id = s.id) AS lines
  FROM sales_invoices s
  UNION ALL
  SELECT 'JOB', j.id, j.doc_no, j.book_no, j.doc_date, j.customer_id, j.customer_name, j.customer_phone, j.taxable_total,
    j.cgst_total + j.sgst_total + j.igst_total, j.grand_total, j.paid_amount, j.returned_amount, j.status = 'CANCELLED',
    j.status::text, (SELECT count(*)::int FROM job_items i WHERE i.job_id = j.id)
  FROM stitching_jobs j
) b`

function where(q: BillFilters) {
  const c = [Prisma.sql`TRUE`]
  if (q.kind && q.kind !== 'all') c.push(Prisma.sql`b.kind = ${q.kind}`)
  if (q.customerId) c.push(Prisma.sql`b.customer_id = ${q.customerId}`)
  if (q.status === 'POSTED') c.push(Prisma.sql`NOT b.cancelled`)
  if (q.status === 'CANCELLED') c.push(Prisma.sql`b.cancelled`)
  if (q.status === 'unpaid') c.push(Prisma.sql`NOT b.cancelled AND b.grand_total - b.paid_amount - b.returned_amount > 0.004`)
  if (q.from) c.push(Prisma.sql`b.doc_date >= ${q.from}::date`)
  if (q.to) c.push(Prisma.sql`b.doc_date <= ${q.to}::date`)
  if (q.search) {
    const like = `%${q.search}%`
    c.push(Prisma.sql`(b.doc_no ILIKE ${like} OR lower(b.book_no) = lower(${q.search}) OR b.customer_name ILIKE ${like} OR b.customer_phone LIKE ${`%${q.search.replace(/\s/g, '')}%`})`)
  }
  return Prisma.join(c, ' AND ')
}

const toItem = (r: Row) => {
  const due = r.cancelled ? 0 : Math.max(0, Math.round((Number(r.grand_total) - Number(r.paid_amount) - Number(r.returned_amount)) * 100) / 100)
  return {
    kind: r.kind, id: r.id, docNo: r.doc_no, bookNo: r.book_no, docDate: r.doc_date, customerId: r.customer_id, customerName: r.customer_name, customerPhone: r.customer_phone,
    taxable: Number(r.taxable), gst: Number(r.gst), grandTotal: Number(r.grand_total), paidAmount: Number(r.paid_amount), returnedAmount: Number(r.returned_amount),
    status: r.cancelled ? ('CANCELLED' as const) : ('POSTED' as const), stage: r.stage, lines: r.lines, dueAmount: due,
  }
}
export type BillItem = ReturnType<typeof toItem>

// One page (newest first) — also used in batches by the Excel download.
export async function billRows(q: BillFilters, skip: number, take: number, order: 'asc' | 'desc' = 'desc') {
  const dir = order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`
  const rows = await prisma.$queryRaw<Row[]>`SELECT * FROM ${BILLS} WHERE ${where(q)} ORDER BY b.doc_date ${dir}, b.kind, b.id ${dir} LIMIT ${take} OFFSET ${skip}`
  return rows.map(toItem)
}

export async function listBills(q: BillFilters & { page: number; pageSize: number }) {
  const [items, [agg]] = await Promise.all([
    billRows(q, (q.page - 1) * q.pageSize, q.pageSize, q.order === 'oldest' ? 'asc' : 'desc'),
    prisma.$queryRaw<{ total: number; sales: Prisma.Decimal | null; received: Prisma.Decimal | null; returned: Prisma.Decimal | null }[]>`
      SELECT count(*)::int AS total,
        SUM(b.grand_total) FILTER (WHERE NOT b.cancelled) AS sales, SUM(b.paid_amount) FILTER (WHERE NOT b.cancelled) AS received,
        SUM(b.returned_amount) FILTER (WHERE NOT b.cancelled) AS returned
      FROM ${BILLS} WHERE ${where(q)}`,
  ])
  const summary = { sales: Number(agg.sales ?? 0), received: Number(agg.received ?? 0), returned: Number(agg.returned ?? 0) }
  return { items, total: agg.total, summary, page: q.page, pageSize: q.pageSize }
}

// ?kind=SHOP|JOB from the query string (anything else = all bills).
export const billKind = (req: { query: Record<string, unknown> }): BillKind => (req.query.kind === 'SHOP' || req.query.kind === 'JOB' ? req.query.kind : 'all')
