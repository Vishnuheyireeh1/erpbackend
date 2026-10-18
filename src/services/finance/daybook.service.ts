import { sortDir, type ListOrder } from '../../utils/order'
import { prisma } from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import { todayIST, toDocDate } from '../../utils/financialYear'
import type { TallyInput } from '../../validators/finance.validator'
import { audit } from '../audit.service'
import { getSetting } from '../settings.service'

// Day book: every rupee in or out, read from each module's own table (nothing copied).
// Account: CASH mode = cash in hand; UPI / CARD / BANK / CHEQUE = bank. Cancelled documents never count.

const r2 = (n: number) => Math.round(n * 100) / 100

// One row per money line: date, time, kind, link id, document, party, mode, in, out.
const LINES = Prisma.sql`
  SELECT r.doc_date AS d, r.created_at AS t, 'RECEIPT' AS kind, r.id AS ref_id, r.doc_no, COALESCE(c.name, 'Cash customer') AS party, tn.mode::text AS mode, tn.amount AS amt_in, 0::numeric AS amt_out
    FROM receipt_tenders tn JOIN customer_receipts r ON r.id = tn.receipt_id LEFT JOIN customers c ON c.id = r.customer_id WHERE r.status = 'POSTED'
  UNION ALL SELECT x.doc_date, x.created_at, 'REFUND', x.id, x.doc_no, COALESCE(c.name, 'Walk-in customer'), x.refund_mode::text, 0, x.refund_amount
    FROM sales_returns x LEFT JOIN customers c ON c.id = x.customer_id WHERE x.status = 'POSTED' AND x.refund_amount > 0 AND x.refund_mode IS NOT NULL
  UNION ALL SELECT p.doc_date, p.created_at, 'BRAND_PAYMENT', p.brand_id, p.doc_no, b.name, p.mode::text, p.amount, 0
    FROM brand_payments p JOIN partner_brands b ON b.id = p.brand_id WHERE p.status = 'POSTED'
  UNION ALL SELECT p.doc_date, p.created_at, 'SUPPLIER_PAYMENT', p.id, p.doc_no, s.name, p.mode::text, 0, p.amount
    FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id WHERE p.status = 'POSTED'
  UNION ALL SELECT e.doc_date, e.created_at, 'JOURNAL', e.id, e.doc_no, COALESCE(l.note, e.narration), CASE WHEN l.account_code = '1000' THEN 'CASH' ELSE 'BANK' END, l.debit, l.credit
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.status = 'POSTED' AND l.account_code IN ('1000', '1010')
  UNION ALL SELECT p.freight_paid_on, COALESCE(p.freight_paid_at, p.created_at), 'FREIGHT', p.id, p.doc_no, COALESCE(p.freight_note, 'Transporter · ' || s.name), p.freight_mode::text, 0, p.freight_separate
    FROM purchase_invoices p JOIN suppliers s ON s.id = p.supplier_id WHERE p.status = 'POSTED' AND p.freight_mode IS NOT NULL AND p.freight_separate > 0
  UNION ALL SELECT p.doc_date, p.created_at, 'TAILOR_PAYMENT', p.id, p.doc_no, tl.name, p.mode::text, 0, p.amount
    FROM tailor_payments p JOIN tailors tl ON tl.id = p.tailor_id WHERE p.status = 'POSTED'
  UNION ALL SELECT e.date, e.created_at, 'JOB_COST', e.job_id, j.doc_no, k.name, e.mode::text, 0, e.amount
    FROM job_cost_entries e JOIN stitching_jobs j ON j.id = e.job_id JOIN job_cost_categories k ON k.id = e.category_id WHERE e.paid_by = 'PAID' AND e.mode IS NOT NULL
  UNION ALL SELECT f.doc_date, f.created_at, 'FEE', s.id, f.doc_no, s.name, f.mode::text, f.amount, 0
    FROM fee_receipts f JOIN enrolments e ON e.id = f.enrolment_id JOIN students s ON s.id = e.student_id WHERE f.status = 'POSTED'
  UNION ALL SELECT o.doc_date, o.created_at, 'PRODUCTION_COST', o.id, o.doc_no, c.description, c.mode::text, 0, c.amount
    FROM production_costs c JOIN production_orders o ON o.id = c.order_id WHERE c.kind = 'PAID' AND o.status = 'POSTED'
  UNION ALL SELECT p.doc_date, p.created_at, 'SALARY', p.id, p.doc_no, st.name, p.mode::text, 0, p.amount
    FROM salary_payments p JOIN staff st ON st.id = p.staff_id WHERE p.status = 'POSTED'
  UNION ALL SELECT x.doc_date, x.created_at, CASE WHEN ec.kind = 'ASSET' THEN 'ASSET_BOUGHT' ELSE 'EXPENSE' END, x.id, x.doc_no, COALESCE(x.paid_to, ec.name), x.mode::text, 0, x.amount
    FROM expenses x JOIN expense_categories ec ON ec.id = x.category_id WHERE x.status = 'POSTED'
  UNION ALL SELECT m.doc_date, m.created_at, m.kind::text, m.id, m.doc_no, '', CASE WHEN m.kind = 'DEPOSIT' THEN 'CASH' ELSE m.mode::text END,
      CASE WHEN m.kind IN ('OWNER_IN', 'OTHER_INCOME') THEN m.amount ELSE 0 END, CASE WHEN m.kind IN ('DEPOSIT', 'WITHDRAW', 'OWNER_OUT') THEN m.amount ELSE 0 END
    FROM money_movements m WHERE m.status = 'POSTED'
  UNION ALL SELECT m.doc_date, m.created_at, m.kind::text, m.id, m.doc_no, '', CASE WHEN m.kind = 'DEPOSIT' THEN m.mode::text ELSE 'CASH' END, m.amount, 0
    FROM money_movements m WHERE m.status = 'POSTED' AND m.kind IN ('DEPOSIT', 'WITHDRAW')`

type Line = { d: Date; t: Date; kind: string; ref_id: number; doc_no: string; party: string; mode: string; amt_in: Prisma.Decimal; amt_out: Prisma.Decimal }
const account = (mode: string) => (mode === 'CASH' ? 'CASH' : 'BANK')

// Balances (opening setting + everything before `before`), per account.
async function balancesBefore(before: string) {
  const [opening, rows] = await Promise.all([
    getSetting('money.opening'),
    prisma.$queryRaw<{ acc: string; net: Prisma.Decimal }[]>`
      SELECT CASE WHEN mode = 'CASH' THEN 'CASH' ELSE 'BANK' END AS acc, SUM(amt_in - amt_out) AS net
      FROM (${LINES}) l WHERE d < ${before}::date GROUP BY 1`,
  ])
  const net = (a: string) => Number(rows.find((r) => r.acc === a)?.net ?? 0)
  return { cash: r2(opening.cash + net('CASH')), bank: r2(opening.bank + net('BANK')) }
}

export async function dayBook(q: { from?: string; to?: string; order?: ListOrder }) {
  const from = q.from ?? todayIST()
  const to = q.to ?? from
  if (to < from) throw ApiError.badRequest('"To" is before "From"')
  const dir = q.order === 'oldest' ? Prisma.sql`ASC` : Prisma.sql`DESC` // newest first by default
  const [opening, lines] = await Promise.all([
    balancesBefore(from),
    prisma.$queryRaw<Line[]>`SELECT * FROM (${LINES}) l WHERE d BETWEEN ${from}::date AND ${to}::date ORDER BY d ${dir}, t ${dir}, doc_no ${dir}`,
  ])
  const rows = lines.map((l) => ({ date: l.d, time: l.t, kind: l.kind, refId: l.ref_id, docNo: l.doc_no, party: l.party, mode: l.mode, account: account(l.mode), in: Number(l.amt_in), out: Number(l.amt_out) }))
  const sum = (acc: 'CASH' | 'BANK', f: 'in' | 'out') => r2(rows.filter((r) => r.account === acc).reduce((s, r) => s + r[f], 0))
  const totals = {
    cash: { opening: opening.cash, in: sum('CASH', 'in'), out: sum('CASH', 'out'), closing: r2(opening.cash + sum('CASH', 'in') - sum('CASH', 'out')) },
    bank: { opening: opening.bank, in: sum('BANK', 'in'), out: sum('BANK', 'out'), closing: r2(opening.bank + sum('BANK', 'in') - sum('BANK', 'out')) },
  }
  // Money received split by mode (cash / UPI / card …) — what the counter took.
  const byMode = ['CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE'].map((m) => ({ mode: m, in: r2(rows.filter((r) => r.mode === m).reduce((s, r) => s + r.in, 0)), out: r2(rows.filter((r) => r.mode === m).reduce((s, r) => s + r.out, 0)) }))
  return { from, to, rows, totals, byMode }
}

// ---- Cash tally (end of day count) ----
export async function getTally(date?: string) {
  const day = date ?? todayIST()
  const [book, saved] = await Promise.all([dayBook({ from: day, to: day }), prisma.cashTally.findUnique({ where: { date: new Date(`${day}T00:00:00Z`) } })])
  return { date: day, expected: book.totals.cash.closing, saved }
}

export async function saveTally(input: TallyInput, user: string) {
  const { date, isFuture } = toDocDate(input.date)
  if (isFuture) throw ApiError.badRequest("Date can't be in the future")
  const day = date.toISOString().slice(0, 10)
  const { expected } = await getTally(day)
  const difference = r2(input.counted - expected)
  await prisma.$transaction(async (tx) => {
    await tx.cashTally.upsert({
      where: { date },
      create: { date, expected, counted: input.counted, difference, note: input.note, createdBy: user },
      update: { expected, counted: input.counted, difference, note: input.note, createdBy: user },
    })
    await audit(tx, { actor: user, action: 'cash_tally.save', entity: 'cash_tally', entityId: day, summary: `Cash ${day}: expected ₹${expected}, counted ₹${input.counted}, ${difference === 0 ? 'tallies' : difference < 0 ? `short ₹${-difference}` : `excess ₹${difference}`}` })
  })
  return getTally(day)
}

export async function tallyHistory(q: { from?: string; to?: string; order?: ListOrder }) {
  const where = q.from || q.to ? { date: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}), ...(q.to ? { lte: new Date(`${q.to}T00:00:00Z`) } : {}) } } : {}
  return prisma.cashTally.findMany({ where, orderBy: { date: sortDir(q.order) }, take: 400 })
}
