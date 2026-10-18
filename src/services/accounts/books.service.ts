import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import { todayIST } from '../../utils/financialYear'
import type { Period } from '../../validators/accounts.validator'
import { accountMap, isProfitAndLoss, type Account, type AccountKind } from './chart'
import { POSTINGS } from './postings.sql'

// The three books a CA asks for — Trial balance, Profit & loss, Balance sheet — read from the automatic entries.
// Amounts: + = debit, − = credit. Year = Indian financial year (1 April → 31 March).

const r2 = (n: number) => Math.round(n * 100) / 100
type Num = unknown
const num = (v: Num) => r2(Number(v ?? 0))

// 1 April of the financial year a date falls in: "2026-10-11" → "2026-04-01", "2027-02-01" → "2026-04-01".
export function fyStart(day: string) {
  const y = Number(day.slice(0, 4))
  return `${Number(day.slice(5, 7)) >= 4 ? y : y - 1}-04-01`
}
export function period(q: Period) {
  const to = q.to ?? todayIST()
  const from = q.from ?? fyStart(to)
  if (from > to) throw ApiError.badRequest('"From" is after "To"')
  return { from, to }
}
const named = (map: Map<string, Account>, code: string): Account =>
  map.get(code) ?? { code, name: `Account ${code}`, kind: 'INDIRECT_EXPENSE', hint: '', builtIn: false, isActive: false }

// Trial balance for a period: opening, debits, credits, closing per account. Income / expense accounts start
// again every 1 April — earlier years' profit is carried in one line (P-EARLY).
export async function trialBalance(q: Period) {
  const { from, to } = period(q)
  const cut = from < fyStart(to) ? from : fyStart(to)
  const [rows, map] = await Promise.all([
    prisma.$queryRaw<{ acct: string; open: Num; dr: Num; cr: Num; carried: Num }[]>`
      SELECT acct,
        COALESCE(SUM(amt) FILTER (WHERE d < ${from}::date), 0) AS open,
        COALESCE(SUM(amt) FILTER (WHERE d >= ${from}::date AND amt > 0), 0) AS dr,
        COALESCE(-SUM(amt) FILTER (WHERE d >= ${from}::date AND amt < 0), 0) AS cr,
        COALESCE(SUM(amt) FILTER (WHERE d < ${cut}::date), 0) AS carried
      FROM (${POSTINGS}) p WHERE d <= ${to}::date GROUP BY acct`,
    accountMap(),
  ])
  let carried = 0
  const lines = rows.map((r) => {
    const a = named(map, r.acct)
    const pl = isProfitAndLoss(a.kind)
    if (pl) carried += num(r.carried)
    const opening = r2(num(r.open) - (pl ? num(r.carried) : 0))
    const debit = num(r.dr), credit = num(r.cr)
    return { code: a.code, name: a.name, kind: a.kind, opening, debit, credit, closing: r2(opening + debit - credit) }
  })
  if (Math.abs(carried) >= 0.005) {
    lines.push({ code: 'P-EARLY', name: 'Profit of earlier years (carried)', kind: 'EQUITY', opening: r2(carried), debit: 0, credit: 0, closing: r2(carried) })
  }
  const order = [...map.keys()]
  const shown = lines.filter((l) => l.opening || l.debit || l.credit).sort((a, b) => (order.indexOf(a.code) + 1 || 999) - (order.indexOf(b.code) + 1 || 999))
  const sum = (f: (l: (typeof shown)[number]) => number) => r2(shown.reduce((s, l) => s + f(l), 0))
  const totals = {
    debit: sum((l) => l.debit), credit: sum((l) => l.credit),
    closingDr: sum((l) => Math.max(l.closing, 0)), closingCr: sum((l) => Math.max(-l.closing, 0)),
  }
  return { from, to, lines: shown, totals, balanced: Math.abs(totals.closingDr - totals.closingCr) < 0.01 }
}

// Profit & loss for a period from the books: income − direct costs = gross profit; − shop expenses = net profit.
export async function profitLoss(q: Period) {
  const { from, to } = period(q)
  const [rows, map] = await Promise.all([
    prisma.$queryRaw<{ acct: string; v: Num }[]>`SELECT acct, SUM(amt) AS v FROM (${POSTINGS}) p WHERE d BETWEEN ${from}::date AND ${to}::date GROUP BY acct`,
    accountMap(),
  ])
  const group = (kind: AccountKind) =>
    rows.map((r) => ({ a: named(map, r.acct), v: num(r.v) })).filter((x) => x.a.kind === kind && x.v !== 0)
      .map((x) => ({ code: x.a.code, name: x.a.name, amount: kind === 'INCOME' ? r2(-x.v) : x.v }))
      .sort((a, b) => b.amount - a.amount)
  const income = group('INCOME'), direct = group('DIRECT_EXPENSE'), indirect = group('INDIRECT_EXPENSE')
  const total = (l: { amount: number }[]) => r2(l.reduce((s, x) => s + x.amount, 0))
  const grossProfit = r2(total(income) - total(direct))
  const netProfit = r2(grossProfit - total(indirect))
  return { from, to, income, incomeTotal: total(income), direct, directTotal: total(direct), grossProfit, indirect, indirectTotal: total(indirect), netProfit }
}

// Balance sheet on a date: what the shop owns = what it owes + owner's capital (+ profit).
export async function balanceSheet(q: Period) {
  const to = q.to ?? todayIST()
  const fy = fyStart(to)
  const [rows, parties, map] = await Promise.all([
    prisma.$queryRaw<{ acct: string; v: Num; fy: Num }[]>`
      SELECT acct, SUM(amt) AS v, COALESCE(SUM(amt) FILTER (WHERE d >= ${fy}::date), 0) AS fy FROM (${POSTINGS}) p WHERE d <= ${to}::date GROUP BY acct`,
    prisma.$queryRaw<{ owe: Num; adv: Num }[]>`
      SELECT SUM(GREATEST(v, 0)) AS owe, SUM(LEAST(v, 0)) AS adv FROM (SELECT party, SUM(amt) AS v FROM (${POSTINGS}) p
      WHERE acct = '1100' AND d <= ${to}::date GROUP BY party) x`,
    accountMap(),
  ])
  const line = (code: string, name: string, amount: number) => ({ code, name, amount: r2(amount) })
  const assets: ReturnType<typeof line>[] = [], liabilities: ReturnType<typeof line>[] = [], equity: ReturnType<typeof line>[] = []
  let profitYear = 0, profitEarlier = 0
  for (const r of rows) {
    const a = named(map, r.acct), v = num(r.v)
    if (isProfitAndLoss(a.kind)) { profitYear -= num(r.fy); profitEarlier -= v - num(r.fy); continue }
    if (a.code === '1100') continue // split below into dues and advances
    if (a.kind === 'ASSET') assets.push(line(a.code, a.name, v))
    else if (a.kind === 'LIABILITY') liabilities.push(line(a.code, a.name, -v))
    else equity.push(line(a.code, a.name, -v))
  }
  assets.push(line('1100', 'Customers who owe us', num(parties[0]?.owe)))
  liabilities.push(line('1100A', 'Customer advances we hold', -num(parties[0]?.adv)))
  equity.push(line('P-EARLY', 'Profit of earlier years', profitEarlier), line('P-YEAR', `Profit this year (since 1 April ${fy.slice(0, 4)})`, profitYear))
  const order = [...map.keys()]
  const tidy = (l: ReturnType<typeof line>[]) => l.filter((x) => Math.abs(x.amount) >= 0.005).sort((a, b) => (order.indexOf(a.code) + 1 || 999) - (order.indexOf(b.code) + 1 || 999))
  const sum = (l: { amount: number }[]) => r2(l.reduce((s, x) => s + x.amount, 0))
  const A = tidy(assets), L = tidy(liabilities), E = tidy(equity)
  return { to, assets: A, assetsTotal: sum(A), liabilities: L, liabilitiesTotal: sum(L), equity: E, equityTotal: sum(E), balanced: Math.abs(sum(A) - sum(L) - sum(E)) < 0.01 }
}

