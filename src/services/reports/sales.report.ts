import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import { monthRange } from './workshop.report'

// Sales by day and best-selling items (amounts GST included, as billed). Cancelled documents never count.

type Dec = Prisma.Decimal | number | bigint | null
const n = (v: Dec) => Math.round(Number(v ?? 0) * 100) / 100

function range(q: { from?: string; to?: string }) {
  const r = monthRange(q)
  if (r.to < r.from) throw ApiError.badRequest('"To" is before "From"')
  return r
}

// One row per day: counter bills, stitching jobs booked (job bill total), returns, net.
export async function salesByDay(q: { from?: string; to?: string }) {
  const { from, to } = range(q)
  const rows = await prisma.$queryRaw<{ d: Date; bills: Dec; bill_count: Dec; jobs: Dec; job_count: Dec; returns: Dec }[]>`
    SELECT d, SUM(bills) AS bills, SUM(bc) AS bill_count, SUM(jobs) AS jobs, SUM(jc) AS job_count, SUM(ret) AS returns FROM (
      SELECT doc_date AS d, grand_total AS bills, 1 AS bc, 0 AS jobs, 0 AS jc, 0 AS ret FROM sales_invoices WHERE status = 'POSTED' AND doc_date BETWEEN ${from}::date AND ${to}::date
      UNION ALL SELECT doc_date, 0, 0, grand_total, 1, 0 FROM stitching_jobs WHERE status <> 'CANCELLED' AND doc_date BETWEEN ${from}::date AND ${to}::date
      UNION ALL SELECT doc_date, 0, 0, 0, 0, grand_total FROM sales_returns WHERE status = 'POSTED' AND doc_date BETWEEN ${from}::date AND ${to}::date
    ) x GROUP BY d ORDER BY d`
  // Every day in the range, even quiet ones (keeps the chart honest).
  const byDay = new Map(rows.map((r) => [r.d.toISOString().slice(0, 10), r]))
  const days: { date: string; bills: number; billCount: number; jobs: number; jobCount: number; returns: number; net: number }[] = []
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`) && days.length < 400; t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10)
    const r = byDay.get(date)
    const bills = n(r?.bills ?? 0), jobs = n(r?.jobs ?? 0), returns = n(r?.returns ?? 0)
    days.push({ date, bills, billCount: Number(r?.bill_count ?? 0), jobs, jobCount: Number(r?.job_count ?? 0), returns, net: n(bills + jobs - returns) })
  }
  const sum = (k: 'bills' | 'jobs' | 'returns' | 'net' | 'billCount' | 'jobCount') => n(days.reduce((s, d) => s + d[k], 0))
  return { from, to, days, total: { bills: sum('bills'), billCount: sum('billCount'), jobs: sum('jobs'), jobCount: sum('jobCount'), returns: sum('returns'), net: sum('net') } }
}

// Items sold (counter + items sold on jobs − returned), by product.
export async function topItems(q: { from?: string; to?: string; limit?: number }) {
  const { from, to } = range(q)
  const limit = Math.min(Math.max(q.limit ?? 20, 1), 500)
  const rows = await prisma.$queryRaw<{ product_id: number; name: string; qty: Dec; amount: Dec; profit: Dec }[]>`
    SELECT p.id AS product_id, p.name, SUM(x.qty) AS qty, SUM(x.amount) AS amount, SUM(x.taxable - x.cost) AS profit FROM (
      SELECT l.variant_id, l.qty - l.returned_qty AS qty, l.amount * (l.qty - l.returned_qty) / NULLIF(l.qty, 0) AS amount,
             l.taxable * (l.qty - l.returned_qty) / NULLIF(l.qty, 0) AS taxable, (l.qty - l.returned_qty) * l.unit_cost AS cost
        FROM sales_lines l JOIN sales_invoices i ON i.id = l.invoice_id WHERE i.status = 'POSTED' AND i.doc_date BETWEEN ${from}::date AND ${to}::date
      UNION ALL
      SELECT m.variant_id, m.qty - m.returned_qty, m.amount * (m.qty - m.returned_qty) / NULLIF(m.qty, 0),
             m.taxable * (m.qty - m.returned_qty) / NULLIF(m.qty, 0), (m.qty - m.returned_qty) * m.unit_cost
        FROM job_materials m JOIN stitching_jobs j ON j.id = m.job_id
        WHERE NOT m.included AND j.status <> 'CANCELLED' AND (m.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date
    ) x JOIN product_variants v ON v.id = x.variant_id JOIN products p ON p.id = v.product_id
    GROUP BY p.id, p.name HAVING SUM(x.qty) > 0 ORDER BY SUM(x.amount) DESC NULLS LAST LIMIT ${limit}`
  return { from, to, items: rows.map((r) => ({ productId: r.product_id, name: r.name, qty: Number(r.qty ?? 0), amount: n(r.amount), profit: n(r.profit) })) }
}
