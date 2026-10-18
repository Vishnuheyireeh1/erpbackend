import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import { monthRange } from './workshop.report'

// Sales by category / by customer, purchases by supplier / by item. Amounts as billed (GST included)
// unless named "before GST". Cancelled documents never count; returns are taken off.

type Dec = Prisma.Decimal | number | bigint | null
const n = (v: Dec) => Math.round(Number(v ?? 0) * 100) / 100
type Range = { from?: string; to?: string }

function range(q: Range) {
  const r = monthRange(q)
  if (r.to < r.from) throw ApiError.badRequest('"To" is before "From"')
  return r
}

// Goods sold (counter + items sold on jobs, after returns) per category, plus one row for stitching charges.
export async function salesByCategory(q: Range) {
  const { from, to } = range(q)
  const rows = await prisma.$queryRaw<{ category: string; qty: Dec; amount: Dec; profit: Dec }[]>`
    SELECT COALESCE(pc.name || ' › ', '') || c.name AS category, SUM(x.qty) AS qty, SUM(x.amount) AS amount, SUM(x.taxable - x.cost) AS profit FROM (
      SELECT l.variant_id, l.qty - l.returned_qty AS qty, l.amount * (l.qty - l.returned_qty) / NULLIF(l.qty, 0) AS amount,
             l.taxable * (l.qty - l.returned_qty) / NULLIF(l.qty, 0) AS taxable, (l.qty - l.returned_qty) * l.unit_cost AS cost
        FROM sales_lines l JOIN sales_invoices i ON i.id = l.invoice_id WHERE i.status = 'POSTED' AND i.doc_date BETWEEN ${from}::date AND ${to}::date
      UNION ALL
      SELECT m.variant_id, m.qty - m.returned_qty, m.amount * (m.qty - m.returned_qty) / NULLIF(m.qty, 0),
             m.taxable * (m.qty - m.returned_qty) / NULLIF(m.qty, 0), (m.qty - m.returned_qty) * m.unit_cost
        FROM job_materials m JOIN stitching_jobs j ON j.id = m.job_id
       WHERE NOT m.included AND j.status <> 'CANCELLED' AND (m.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date
    ) x JOIN product_variants v ON v.id = x.variant_id JOIN products p ON p.id = v.product_id
        JOIN categories c ON c.id = p.category_id LEFT JOIN categories pc ON pc.id = c.parent_id
    GROUP BY 1 HAVING SUM(x.qty) > 0 ORDER BY SUM(x.amount) DESC NULLS LAST`
  const [stitch] = await prisma.$queryRaw<{ amount: Dec; jobs: Dec }[]>`
    SELECT SUM(j.grand_total - COALESCE((SELECT SUM(m.amount) FROM job_materials m WHERE m.job_id = j.id AND NOT m.included), 0)) AS amount, COUNT(*) AS jobs
      FROM stitching_jobs j WHERE j.status <> 'CANCELLED' AND j.doc_date BETWEEN ${from}::date AND ${to}::date`
  const items = rows.map((r) => ({ category: r.category, qty: Number(r.qty ?? 0), amount: n(r.amount), profit: n(r.profit) }))
  const goods = n(items.reduce((s, r) => s + r.amount, 0))
  return { from, to, items, goods, stitching: { amount: n(stitch?.amount), jobs: Number(stitch?.jobs ?? 0) }, total: n(goods + n(stitch?.amount)) }
}

// Per customer: bills + job bills − returns in the period, visits, last visit. Cash sales (no customer) as one row.
export async function salesByCustomer(q: Range) {
  const { from, to } = range(q)
  const rows = await prisma.$queryRaw<{ id: number | null; name: string; phone: string | null; bills: Dec; jobs: Dec; returns: Dec; visits: Dec; last: Date }[]>`
    SELECT d.customer_id AS id, COALESCE(c.name, 'Cash sales (no customer)') AS name, c.phone,
           SUM(d.bills) AS bills, SUM(d.jobs) AS jobs, SUM(d.ret) AS returns, COUNT(*) FILTER (WHERE d.ret = 0) AS visits, MAX(d.d) AS last
      FROM (
        SELECT customer_id, doc_date AS d, grand_total AS bills, 0 AS jobs, 0 AS ret FROM sales_invoices WHERE status = 'POSTED' AND doc_date BETWEEN ${from}::date AND ${to}::date
        UNION ALL SELECT customer_id, doc_date, 0, grand_total, 0 FROM stitching_jobs WHERE status <> 'CANCELLED' AND doc_date BETWEEN ${from}::date AND ${to}::date
        UNION ALL SELECT customer_id, doc_date, 0, 0, grand_total FROM sales_returns WHERE status = 'POSTED' AND doc_date BETWEEN ${from}::date AND ${to}::date
      ) d LEFT JOIN customers c ON c.id = d.customer_id
     GROUP BY d.customer_id, c.name, c.phone ORDER BY SUM(d.bills + d.jobs - d.ret) DESC`
  const items = rows.map((r) => {
    const bills = n(r.bills), jobs = n(r.jobs), returns = n(r.returns)
    return { customerId: r.id, name: r.name, phone: r.phone, bills, jobs, returns, total: n(bills + jobs - returns), visits: Number(r.visits ?? 0), lastVisit: r.last }
  })
  return { from, to, items, total: n(items.reduce((s, r) => s + r.total, 0)), customers: items.filter((i) => i.customerId).length }
}

// Per supplier: bills, value before GST, GST, total, paid, returned, still to pay (bills dated in the period).
export async function purchasesBySupplier(q: Range) {
  const { from, to } = range(q)
  const rows = await prisma.$queryRaw<{ id: number; name: string; bills: Dec; taxable: Dec; gst: Dec; total: Dec; paid: Dec; returned: Dec }[]>`
    SELECT s.id, s.name, COUNT(*) AS bills, SUM(p.taxable_total) AS taxable, SUM(p.cgst_total + p.sgst_total + p.igst_total) AS gst,
           SUM(p.grand_total) AS total, SUM(p.paid_amount) AS paid, SUM(p.returned_amount) AS returned
      FROM purchase_invoices p JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.status = 'POSTED' AND p.doc_date BETWEEN ${from}::date AND ${to}::date
     GROUP BY s.id, s.name ORDER BY SUM(p.grand_total) DESC`
  const items = rows.map((r) => ({ supplierId: r.id, name: r.name, bills: Number(r.bills), taxable: n(r.taxable), gst: n(r.gst), total: n(r.total), paid: n(r.paid), returned: n(r.returned), due: n(Number(r.total) - Number(r.paid) - Number(r.returned)) }))
  const sum = (k: 'taxable' | 'gst' | 'total' | 'paid' | 'returned' | 'due') => n(items.reduce((s, r) => s + r[k], 0))
  return { from, to, items, total: { taxable: sum('taxable'), gst: sum('gst'), total: sum('total'), paid: sum('paid'), returned: sum('returned'), due: sum('due') } }
}

// Per item: quantity bought (after returns), value before GST, average rate, suppliers.
export async function purchasesByItem(q: Range & { limit?: number }) {
  const { from, to } = range(q)
  const limit = Math.min(Math.max(q.limit ?? 200, 1), 5000)
  const rows = await prisma.$queryRaw<{ variant_id: number; name: string; sku: string; unit: string; qty: Dec; taxable: Dec; suppliers: string }[]>`
    SELECT v.id AS variant_id, p.name || COALESCE(' · ' || sz.name, '') || COALESCE(' · ' || co.name, '') AS name, v.sku, u.code AS unit,
           SUM(l.qty - COALESCE(r.qty, 0)) AS qty, SUM(l.taxable - COALESCE(r.taxable, 0)) AS taxable, string_agg(DISTINCT s.name, ', ') AS suppliers
      FROM purchase_lines l JOIN purchase_invoices i ON i.id = l.invoice_id JOIN suppliers s ON s.id = i.supplier_id
      JOIN product_variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id JOIN units u ON u.id = p.unit_id
      LEFT JOIN sizes sz ON sz.id = v.size_id LEFT JOIN colours co ON co.id = v.colour_id
      LEFT JOIN (SELECT rl.purchase_line_id, SUM(rl.qty) AS qty, SUM(rl.taxable) AS taxable FROM purchase_return_lines rl
                   JOIN purchase_returns rr ON rr.id = rl.return_id WHERE rr.status = 'POSTED' GROUP BY 1) r ON r.purchase_line_id = l.id
     WHERE i.status = 'POSTED' AND i.doc_date BETWEEN ${from}::date AND ${to}::date
     GROUP BY v.id, p.name, sz.name, co.name, v.sku, u.code ORDER BY SUM(l.taxable - COALESCE(r.taxable, 0)) DESC LIMIT ${limit}`
  const items = rows.map((r) => {
    const qty = Number(r.qty ?? 0), taxable = n(r.taxable)
    return { variantId: r.variant_id, name: r.name, sku: r.sku, unit: r.unit, qty, taxable, avgRate: qty ? n(taxable / qty) : 0, suppliers: r.suppliers }
  })
  return { from, to, items }
}
