import { prisma } from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'

// Worker money: pay EARNED on jobs that reached Ready (or were handed over) — stitching (garment lines) and other work
// done by them (embroidery, cutting … — per-piece pay, or ₹0 for salaried people so their work still shows) — and on
// production entries, minus PAYMENTS. Pieces = garments stitched + pieces of other work done.
// Production labour is part of the finished goods' stock cost — profit & loss counts it when the pieces are sold.
// balance = opening + earned − paid   (+ = shop owes the tailor). Earned date = first day the job reached Ready.

const r2 = (n: number) => Math.round(n * 100) / 100

// kind JOB → job_id is the job; PRD → the production entry; BRD → the brand order (pieces ready the same day together).
export type EarnedKind = 'JOB' | 'PRD' | 'BRD'
export type EarnedRow = { tailor_id: number; kind: EarnedKind; job_id: number; doc_no: string; earned_on: Date; pieces: number; labour: Prisma.Decimal; garments: string }

// One row per tailor per job. Optional filters: tailors, earned-date range (inclusive, YYYY-MM-DD).
// kind: one kind or several (stitching work = ['JOB', 'BRD']).
export function earnedRows(f: { tailorIds?: number[]; from?: string; to?: string; kind?: EarnedKind | EarnedKind[] } = {}) {
  const conds = [Prisma.sql`TRUE`]
  if (f.kind) conds.push(Prisma.sql`kind = ANY(${Array.isArray(f.kind) ? f.kind : [f.kind]})`)
  if (f.tailorIds) conds.push(Prisma.sql`tailor_id = ANY(${f.tailorIds})`)
  if (f.from) conds.push(Prisma.sql`earned_on >= ${f.from}::date`)
  if (f.to) conds.push(Prisma.sql`earned_on <= ${f.to}::date`)
  return prisma.$queryRaw<EarnedRow[]>`
    WITH earned AS (
      SELECT w.tailor_id, 'JOB' AS kind, j.id AS job_id, j.doc_no,
        COALESCE((SELECT (min(l.at) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date FROM job_status_logs l
                  WHERE l.job_id = j.id AND l.to_status IN ('READY', 'DELIVERED')), j.doc_date) AS earned_on,
        SUM(w.pieces)::int AS pieces, SUM(w.labour) AS labour,
        string_agg(w.what, ', ' ORDER BY w.so) AS garments
      FROM (SELECT i.job_id, i.tailor_id, i.qty AS pieces, i.qty * i.labour_rate AS labour, i.qty || ' × ' || i.description AS what, i.sort_order AS so
          FROM job_items i WHERE i.tailor_id IS NOT NULL
        UNION ALL SELECT e.job_id, e.tailor_id, e.qty::int, e.amount, e.qty::numeric(14,0) || ' × ' || k.name || COALESCE(' · ' || e.description, ''), 1000 + e.id
          FROM job_cost_entries e JOIN job_cost_categories k ON k.id = e.category_id
          WHERE e.tailor_id IS NOT NULL AND e.paid_by IN ('WORKER', 'SALARIED')) w JOIN stitching_jobs j ON j.id = w.job_id
      WHERE j.status IN ('READY', 'DELIVERED')
      GROUP BY w.tailor_id, j.id
      UNION ALL
      SELECT c.tailor_id, 'PRD', o.id, o.doc_no, o.doc_date, SUM(c.qty)::int, SUM(c.amount), string_agg(c.qty::numeric(14,0) || ' × ' || c.description, ', ' ORDER BY c.sort_order)
      FROM production_costs c JOIN production_orders o ON o.id = c.order_id
      WHERE c.kind = 'TAILOR' AND o.status = 'POSTED'
      GROUP BY c.tailor_id, o.id
      UNION ALL
      SELECT i.tailor_id, 'BRD', o.id, o.doc_no, i.ready_on, SUM(i.qty)::int, SUM(i.qty * i.labour_rate),
        string_agg(i.qty || ' × ' || i.description || COALESCE(' · ' || i.end_customer, '') || ' (' || o.brand_name || ')', ', ' ORDER BY i.sort_order)
      FROM brand_order_items i JOIN brand_orders o ON o.id = i.order_id
      WHERE i.tailor_id IS NOT NULL AND i.stage IN ('READY', 'DELIVERED') AND i.ready_on IS NOT NULL AND o.status <> 'CANCELLED'
      GROUP BY i.tailor_id, o.id, i.ready_on
      UNION ALL
      SELECT c.tailor_id, 'BRD', o.id, o.doc_no, c.date, SUM(c.qty)::int, SUM(c.amount),
        string_agg(c.qty::numeric(14,0) || ' × ' || k.name || COALESCE(' · ' || c.description, '') || ' (' || o.brand_name || ')', ', ' ORDER BY c.id)
      FROM brand_order_costs c JOIN brand_orders o ON o.id = c.order_id JOIN job_cost_categories k ON k.id = c.category_id
      WHERE c.tailor_id IS NOT NULL AND c.paid_by IN ('WORKER', 'SALARIED') AND o.status <> 'CANCELLED'
      GROUP BY c.tailor_id, o.id, c.date
    )
    SELECT * FROM earned WHERE ${Prisma.join(conds, ' AND ')} ORDER BY earned_on, job_id`
}

// Earned + paid totals for many tailors (list screen).
export async function balances(ids: number[]) {
  const map = new Map(ids.map((id) => [id, { earned: 0, paid: 0 }]))
  if (!ids.length) return map
  const [earned, paid] = await Promise.all([
    earnedRows({ tailorIds: ids }),
    prisma.tailorPayment.groupBy({ by: ['tailorId'], where: { tailorId: { in: ids }, status: 'POSTED' }, _sum: { amount: true } }),
  ])
  for (const e of earned) map.get(e.tailor_id)!.earned = r2(map.get(e.tailor_id)!.earned + Number(e.labour))
  for (const p of paid) map.get(p.tailorId)!.paid = Number(p._sum.amount ?? 0)
  return map
}

export async function statement(id: number) {
  const tailor = await prisma.tailor.findUnique({ where: { id } })
  if (!tailor) throw ApiError.notFound('Tailor not found')
  const [earned, payments] = await Promise.all([
    earnedRows({ tailorIds: [id] }),
    prisma.tailorPayment.findMany({ where: { tailorId: id, status: 'POSTED' }, orderBy: [{ docDate: 'asc' }, { id: 'asc' }] }),
  ])
  type Row = { type: 'WORK' | 'PAYMENT'; kind?: EarnedKind; id: number; docNo: string; date: Date; detail: string; pieces: number; earned: number; paid: number }
  const rows: Row[] = [
    ...earned.map((e) => ({ type: 'WORK' as const, kind: e.kind, id: e.job_id, docNo: e.doc_no, date: e.earned_on, detail: e.garments, pieces: e.pieces, earned: Number(e.labour), paid: 0 })),
    ...payments.map((p) => ({ type: 'PAYMENT' as const, id: p.id, docNo: p.docNo, date: p.docDate, detail: `Paid (${p.mode})${p.reference ? ` ${p.reference}` : ''}`, pieces: 0, earned: 0, paid: Number(p.amount) })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || (a.type === b.type ? a.id - b.id : a.type === 'WORK' ? -1 : 1))
  let balance = Number(tailor.openingBalance)
  const withBalance = rows.map((r) => ({ ...r, balance: (balance = r2(balance + r.earned - r.paid)) }))
  const totals = { earned: r2(rows.reduce((s, r) => s + r.earned, 0)), paid: r2(rows.reduce((s, r) => s + r.paid, 0)), pieces: rows.reduce((s, r) => s + r.pieces, 0) }
  return { tailor: { ...tailor, balance: r2(balance) }, opening: Number(tailor.openingBalance), rows: withBalance, closing: r2(balance), totals }
}
