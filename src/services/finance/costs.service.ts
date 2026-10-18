import type { ListOrder } from '../../utils/order'
import { prisma } from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { monthRange } from '../reports/workshop.report'
import { workerPayRows } from './workerPay.service'

// Expenses page: EVERY cost of the period in one list — typed expenses, salary (all staff, by the month it is for),
// per-piece worker pay (jobs + brand orders), job costs paid out, cloth given free for stitching (jobs + brand orders) and stock adjustments — each marked
// Direct / Indirect — plus assets bought (AC, machine …), listed with an "Asset" tag but NOT in the expense totals
// (they are what the shop owns). Same rules as profit & loss, so the totals match its direct and shop-expense figures.

const r2 = (n: number) => Math.round(n * 100) / 100
export type CostKind = 'DIRECT' | 'INDIRECT' | 'ASSET' // ASSET = bought to keep (AC, machine) — not a cost
type Raw = { src: string; ref_id: number; d: Date; doc_no: string; what: string; detail: string | null; kind: CostKind; mode: string | null; amount: Prisma.Decimal; cancelled: boolean }

export async function costRows(q: { from?: string; to?: string; kind?: CostKind; search?: string; order?: ListOrder }) {
  const { from, to } = monthRange(q)
  const [raw, pay] = await Promise.all([
    prisma.$queryRaw<Raw[]>`
      SELECT 'EXPENSE' AS src, x.id AS ref_id, x.doc_date AS d, x.doc_no, c.name AS what, NULLIF(CONCAT_WS(' · ', x.paid_to, x.notes), '') AS detail,
        c.kind::text AS kind, x.mode::text AS mode, x.amount, x.status = 'CANCELLED' AS cancelled
      FROM expenses x JOIN expense_categories c ON c.id = x.category_id WHERE x.doc_date BETWEEN ${from}::date AND ${to}::date
      UNION ALL SELECT 'SALARY', p.id, p.doc_date, p.doc_no, 'Salary · ' || to_char(p.month, 'Mon YYYY'),
        s.name || ' (' || s.role || ' · ' || CASE WHEN s.dept = 'WORKSHOP' THEN 'Workshop' ELSE 'Shop' END || ')', 'INDIRECT', p.mode::text, p.amount, false
      FROM salary_payments p JOIN staff s ON s.id = p.staff_id
      WHERE p.status = 'POSTED' AND p.month BETWEEN date_trunc('month', ${from}::date)::date AND ${to}::date
      UNION ALL SELECT 'JOB_COST', e.job_id, e.date, j.doc_no, k.name || ' (paid out)', NULLIF(CONCAT_WS(' · ', j.customer_name, e.description), ''), 'DIRECT', e.mode::text, e.amount, false
      FROM job_cost_entries e JOIN stitching_jobs j ON j.id = e.job_id JOIN job_cost_categories k ON k.id = e.category_id
      WHERE e.paid_by = 'PAID' AND e.date BETWEEN ${from}::date AND ${to}::date
      UNION ALL SELECT 'MATERIAL', j.id, (m.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date, j.doc_no, 'Cloth given free for stitching',
        m.description || ' · ' || j.customer_name, 'DIRECT', NULL, m.qty * m.unit_cost, false
      FROM job_materials m JOIN stitching_jobs j ON j.id = m.job_id
      WHERE m.included AND j.status <> 'CANCELLED' AND (m.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date
      UNION ALL SELECT 'BRAND_CLOTH', o.id, m.movement_date, o.doc_no, 'Cloth used free (brand order)', o.brand_name, 'DIRECT', NULL, -SUM(m.value), false
      FROM stock_movements m JOIN brand_orders o ON o.id = m.ref_id
      WHERE m.ref_type = 'BRO' AND m.type NOT IN ('SALE', 'SALE_RETURN') AND m.movement_date BETWEEN ${from}::date AND ${to}::date
      GROUP BY o.id, o.doc_no, o.brand_name, m.movement_date HAVING SUM(m.value) <> 0
      UNION ALL SELECT 'ADJUST', d.id, m.movement_date, d.doc_no, 'Stock adjustment (damage / count)', d.note, 'DIRECT', NULL, -SUM(m.value), false
      FROM stock_movements m JOIN stock_documents d ON d.id = m.ref_id AND d.status = 'POSTED'
      WHERE m.ref_type = 'ADJ' AND m.movement_date BETWEEN ${from}::date AND ${to}::date GROUP BY d.id, d.doc_no, d.note, m.movement_date`,
    workerPayRows({ from, to }),
  ])
  const rows = [
    ...raw.map((r) => ({ key: `${r.src}-${r.ref_id}-${r.doc_no}-${r.what}`, source: r.src, refId: r.ref_id, date: r.d, docNo: r.doc_no, what: r.what, detail: r.detail, kind: r.kind, mode: r.mode, amount: r2(Number(r.amount)), cancelled: r.cancelled })),
    ...pay.rows.map((p) => ({
      key: `PAY-${p.kind}-${p.jobId}-${p.workerId}-${p.date.getTime()}`, source: p.kind === 'BRD' ? 'BRAND_PAY' : 'WORKER_PAY', refId: p.jobId, date: p.date, docNo: p.docNo, what: 'Worker pay (per piece)',
      detail: `${p.worker} · ${p.customerName} · ${p.work}`, kind: 'DIRECT' as CostKind, mode: null, amount: p.amount, cancelled: false,
    })),
  ]
    .filter((r) => !q.kind || r.kind === q.kind)
    .filter((r) => !q.search || `${r.what} ${r.detail ?? ''} ${r.docNo}`.toLowerCase().includes(q.search.toLowerCase()))
    .sort((a, b) => (q.order === 'oldest' ? 1 : -1) * (a.date.getTime() - b.date.getTime()) || a.what.localeCompare(b.what))
  const sum = (k: CostKind) => r2(rows.filter((r) => !r.cancelled && r.kind === k).reduce((s, r) => s + r.amount, 0))
  const direct = sum('DIRECT'), indirect = sum('INDIRECT')
  return { from, to, rows, totals: { all: r2(direct + indirect), direct, indirect, assets: sum('ASSET') } }
}
