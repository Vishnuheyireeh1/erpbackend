import { prisma } from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import { todayIST } from '../../utils/financialYear'
import * as customers from '../../models/customer.model'

// Stock value on a date, slow-moving stock, and who owes the shop (by how old the bill is).

type Dec = Prisma.Decimal | number | bigint | null
const n = (v: Dec | undefined) => Math.round(Number(v ?? 0) * 100) / 100
const itemName = Prisma.sql`p.name || COALESCE(' · ' || sz.name, '') || COALESCE(' · ' || co.name, '')`
const joins = Prisma.sql`JOIN product_variants v ON v.id = x.variant_id JOIN products p ON p.id = v.product_id JOIN units u ON u.id = p.unit_id
  JOIN categories c ON c.id = p.category_id LEFT JOIN sizes sz ON sz.id = v.size_id LEFT JOIN colours co ON co.id = v.colour_id`
const searchSql = (s?: string) => (s ? Prisma.sql`AND (p.name ILIKE ${`%${s}%`} OR v.sku ILIKE ${`%${s.toUpperCase()}%`} OR c.name ILIKE ${`%${s}%`})` : Prisma.empty)

// Stock as it was at the end of a day (e.g. 31 March for the year-end): every movement up to that date added up.
export async function stockOnDate(q: { date?: string; search?: string; page?: number; pageSize?: number }) {
  const date = q.date ?? todayIST()
  if (date > todayIST()) throw ApiError.badRequest("Date can't be in the future")
  const page = Math.max(1, q.page ?? 1), size = Math.min(Math.max(q.pageSize ?? 50, 1), 100_000)
  const base = Prisma.sql`
    SELECT x.variant_id, ${itemName} AS name, v.sku, u.code AS unit, c.name AS category, x.qty, x.value FROM (
      -- quantity = every movement up to the date; value = that quantity × the average cost at the last movement of that date
      SELECT variant_id, SUM(qty) AS qty,
             ROUND(SUM(qty) * (array_agg(COALESCE(balance_value / NULLIF(balance_qty, 0), unit_cost) ORDER BY movement_date DESC, id DESC))[1], 2) AS value
        FROM stock_movements WHERE movement_date <= ${date}::date GROUP BY variant_id
    ) x ${joins} WHERE x.qty <> 0 ${searchSql(q.search)}`
  const [rows, [tot]] = await Promise.all([
    prisma.$queryRaw<{ variant_id: number; name: string; sku: string; unit: string; category: string; qty: Dec; value: Dec }[]>`${base} ORDER BY p.name, v.sku LIMIT ${size} OFFSET ${(page - 1) * size}`,
    prisma.$queryRaw<{ items: Dec; value: Dec }[]>`SELECT COUNT(*) AS items, SUM(value) AS value FROM (${base}) t`,
  ])
  const items = rows.map((r) => ({ variantId: r.variant_id, name: r.name, sku: r.sku, unit: r.unit, category: r.category, qty: Number(r.qty ?? 0), value: n(r.value), avgCost: Number(r.qty) ? n(Number(r.value) / Number(r.qty)) : 0 }))
  return { date, items, total: Number(tot?.items ?? 0), value: n(tot?.value), page, pageSize: size }
}

// Items in stock that have not been sold / used for N days (default 90) — money stuck on the shelf.
export async function slowMoving(q: { days?: number; search?: string; page?: number; pageSize?: number }) {
  const days = Math.min(Math.max(q.days ?? 90, 7), 3650)
  const page = Math.max(1, q.page ?? 1), size = Math.min(Math.max(q.pageSize ?? 50, 1), 100_000)
  const base = Prisma.sql`
    SELECT x.variant_id, ${itemName} AS name, v.sku, u.code AS unit, c.name AS category, v.stock_qty AS qty, v.stock_value AS value, x.last_out, x.first_in FROM (
      SELECT v2.id AS variant_id,
             (SELECT MAX(movement_date) FROM stock_movements m WHERE m.variant_id = v2.id AND m.type IN ('SALE', 'JOB_CONSUMPTION', 'PRODUCTION_OUT')) AS last_out,
             (SELECT MIN(movement_date) FROM stock_movements m WHERE m.variant_id = v2.id AND m.qty > 0) AS first_in
        FROM product_variants v2 WHERE v2.stock_qty > 0
    ) x ${joins}
    WHERE COALESCE(x.last_out, x.first_in, CURRENT_DATE) <= CURRENT_DATE - ${days}::int ${searchSql(q.search)}`
  const [rows, [tot]] = await Promise.all([
    prisma.$queryRaw<{ variant_id: number; name: string; sku: string; unit: string; category: string; qty: Dec; value: Dec; last_out: Date | null; first_in: Date | null }[]>`${base} ORDER BY v.stock_value DESC LIMIT ${size} OFFSET ${(page - 1) * size}`,
    prisma.$queryRaw<{ items: Dec; value: Dec }[]>`SELECT COUNT(*) AS items, SUM(value) AS value FROM (${base}) t`,
  ])
  const today = Date.parse(`${todayIST()}T00:00:00Z`)
  const items = rows.map((r) => {
    const since = r.last_out ?? r.first_in
    return { variantId: r.variant_id, name: r.name, sku: r.sku, unit: r.unit, category: r.category, qty: Number(r.qty ?? 0), value: n(r.value), lastSold: r.last_out, inStockSince: r.first_in, idleDays: since ? Math.round((today - since.getTime()) / 86_400_000) : null }
  })
  return { days, items, total: Number(tot?.items ?? 0), value: n(tot?.value), page, pageSize: size }
}

// Who owes the shop: unpaid bills / job bills by age, plus old balance and unused advance → same total as the statement.
export async function whoOwes() {
  const rows = await prisma.$queryRaw<{ id: number; d0: Dec; d30: Dec; d60: Dec; d90: Dec; oldest: Date }[]>`
    SELECT customer_id AS id,
           SUM(due) FILTER (WHERE age <= 30) AS d0, SUM(due) FILTER (WHERE age BETWEEN 31 AND 60) AS d30,
           SUM(due) FILTER (WHERE age BETWEEN 61 AND 90) AS d60, SUM(due) FILTER (WHERE age > 90) AS d90, MIN(doc_date) AS oldest
      FROM (
        SELECT customer_id, doc_date, grand_total - paid_amount - returned_amount AS due, CURRENT_DATE - doc_date AS age FROM sales_invoices WHERE status = 'POSTED' AND customer_id IS NOT NULL
        UNION ALL SELECT customer_id, doc_date, grand_total - paid_amount - returned_amount, CURRENT_DATE - doc_date FROM stitching_jobs WHERE status <> 'CANCELLED'
      ) d WHERE due > 0.004 GROUP BY customer_id`
  const opening = await prisma.customer.findMany({ where: { OR: [{ id: { in: rows.map((r) => r.id) } }, { openingBalance: { not: 0 } }] }, select: { id: true, code: true, name: true, phone: true, openingBalance: true } })
  const totals = await customers.totals(opening.map((c) => c.id))
  const items = opening.map((c) => {
    const r = rows.find((x) => x.id === c.id)
    const t = totals.get(c.id)!
    const owed = n(Number(c.openingBalance) + t.billed - t.received - t.returned + t.refunded) // same as the customer statement
    const bills = [n(r?.d0), n(r?.d30), n(r?.d60), n(r?.d90)]
    return { customerId: c.id, code: c.code, name: c.name, phone: c.phone, upTo30: bills[0], d31to60: bills[1], d61to90: bills[2], over90: bills[3], other: n(owed - bills.reduce((s, b) => s + b, 0)), owed, oldestBill: r?.oldest ?? null }
  }).filter((i) => i.owed > 0.004).sort((a, b) => b.owed - a.owed)
  const sum = (k: 'upTo30' | 'd31to60' | 'd61to90' | 'over90' | 'other' | 'owed') => n(items.reduce((s, r) => s + r[k], 0))
  return { items, total: { upTo30: sum('upTo30'), d31to60: sum('d31to60'), d61to90: sum('d61to90'), over90: sum('over90'), other: sum('other'), owed: sum('owed') } }
}
