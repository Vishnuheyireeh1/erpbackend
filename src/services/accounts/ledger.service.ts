import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import type { LedgerQuery, Period } from '../../validators/accounts.validator'
import { fyStart, period } from './books.service'
import { accountMap, isProfitAndLoss } from './chart'
import { POSTINGS, type PostingRow } from './postings.sql'

// One account's entries with a running balance (+ = debit), and the "sales by type" report.

const r2 = (n: number) => Math.round(n * 100) / 100
export const LEDGER_LIMIT = 5000 // screen; Excel has everything

// Names of customers / suppliers / tailors / brands for party codes like C12, S3, T2, B1 (C0 = walk-in / cash customer).
async function partyNames(codes: string[]) {
  const ids = (p: string) => [...new Set(codes.filter((c) => c[0] === p).map((c) => Number(c.slice(1))).filter(Boolean))]
  const [c, s, t, b] = await Promise.all([
    prisma.customer.findMany({ where: { id: { in: ids('C') } }, select: { id: true, name: true, code: true } }),
    prisma.supplier.findMany({ where: { id: { in: ids('S') } }, select: { id: true, name: true, code: true } }),
    prisma.tailor.findMany({ where: { id: { in: ids('T') } }, select: { id: true, name: true, code: true } }),
    prisma.partnerBrand.findMany({ where: { id: { in: ids('B') } }, select: { id: true, name: true, code: true } }),
  ])
  const map = new Map<string, string>([['C0', 'Cash / walk-in customers']])
  c.forEach((x) => map.set(`C${x.id}`, `${x.name} (${x.code})`))
  s.forEach((x) => map.set(`S${x.id}`, `${x.name} (${x.code})`))
  t.forEach((x) => map.set(`T${x.id}`, `${x.name} (${x.code})`))
  b.forEach((x) => map.set(`B${x.id}`, `${x.name} (${x.code})`))
  return map
}

export async function ledger(code: string, q: LedgerQuery, limit = LEDGER_LIMIT) {
  const map = await accountMap()
  const account = map.get(code)
  if (!account) throw ApiError.notFound('Account not found')
  const { from, to } = period(q)
  // Income / expense accounts start from 0 every 1 April.
  const start = isProfitAndLoss(account.kind) ? fyStart(from) : '1900-01-01'
  const party = q.party ?? null
  const [open, rows] = await Promise.all([
    prisma.$queryRaw<{ v: unknown }[]>`SELECT COALESCE(SUM(amt), 0) AS v FROM (${POSTINGS}) p
      WHERE acct = ${code} AND d >= ${start}::date AND d < ${from}::date AND (${party}::text IS NULL OR party = ${party})`,
    prisma.$queryRaw<PostingRow[]>`SELECT * FROM (${POSTINGS}) p WHERE acct = ${code} AND d BETWEEN ${from}::date AND ${to}::date
      AND (${party}::text IS NULL OR party = ${party}) ORDER BY d, src, ref_id LIMIT ${limit + 1}`,
  ])
  const names = await partyNames([...rows.map((r) => r.party), ...(party ? [party] : [])])
  const opening = r2(Number(open[0]?.v ?? 0))
  let balance = opening
  const lines = rows.slice(0, limit).map((r) => {
    const amt = Number(r.amt)
    balance = r2(balance + amt)
    return { date: r.d, src: r.src, refId: r.ref_id, docNo: r.doc_no, party: r.party ? names.get(r.party) ?? r.party : '', memo: r.memo ?? '', debit: amt > 0 ? r2(amt) : 0, credit: amt < 0 ? r2(-amt) : 0, balance }
  })
  return {
    account, from, to, party: party ? { code: party, name: names.get(party) ?? party } : null,
    opening, lines, closing: balance, more: rows.length > limit,
    totals: { debit: r2(lines.reduce((s, l) => s + l.debit, 0)), credit: r2(lines.reduce((s, l) => s + l.credit, 0)) },
  }
}

// Customers / suppliers / tailors with a balance in this account (for the ledger's "who" filter).
export async function ledgerParties(code: string, q: Period) {
  const { to } = period(q)
  const rows = await prisma.$queryRaw<{ party: string; v: unknown }[]>`
    SELECT party, SUM(amt) AS v FROM (${POSTINGS}) p WHERE acct = ${code} AND party <> '' AND d <= ${to}::date GROUP BY party HAVING SUM(amt) <> 0`
  const names = await partyNames(rows.map((r) => r.party))
  return rows.map((r) => ({ code: r.party, name: names.get(r.party) ?? r.party, balance: r2(Number(r.v)) })).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
}

// Income by type — shop sales (net of returns) | stitching | training fees — by day or month, before GST.
export async function salesByType(q: Period & { by: 'day' | 'month' }) {
  const { from, to } = period(q)
  const unit = q.by === 'month' ? 'month' : 'day'
  const rows = await prisma.$queryRaw<{ p: Date; shop: unknown; stitch: unknown; fees: unknown }[]>`
    SELECT date_trunc(${unit}::text, d)::date AS p,
      -COALESCE(SUM(amt) FILTER (WHERE acct IN ('4000', '4010')), 0) AS shop,
      -COALESCE(SUM(amt) FILTER (WHERE acct = '4100'), 0) AS stitch,
      -COALESCE(SUM(amt) FILTER (WHERE acct = '4200'), 0) AS fees
    FROM (${POSTINGS}) x WHERE acct IN ('4000', '4010', '4100', '4200') AND d BETWEEN ${from}::date AND ${to}::date GROUP BY 1 ORDER BY 1`
  const lines = rows.map((r) => {
    const shop = r2(Number(r.shop)), stitching = r2(Number(r.stitch)), fees = r2(Number(r.fees))
    return { period: r.p, shop, stitching, fees, total: r2(shop + stitching + fees) }
  })
  const sum = (f: (l: (typeof lines)[number]) => number) => r2(lines.reduce((s, l) => s + f(l), 0))
  return { from, to, by: q.by, lines, totals: { shop: sum((l) => l.shop), stitching: sum((l) => l.stitching), fees: sum((l) => l.fees), total: sum((l) => l.total) } }
}
