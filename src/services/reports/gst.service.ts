import { prisma } from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import { INWARD, OUTWARD, inRange } from './gst.lines'
import { monthRange } from './workshop.report'

// GST reports for the accountant: summary (like GSTR-3B), bill-wise sales register (GSTR-1 B2B / B2C),
// HSN summary, purchase register (input tax credit). Read-only; returns are netted as negative lines.

type Dec = Prisma.Decimal | number | null
const n = (v: Dec) => Math.round(Number(v ?? 0) * 100) / 100
type TaxRow = { rate: Dec; taxable: Dec; cgst: Dec; sgst: Dec; igst: Dec }
const money = (r: TaxRow) => {
  const out = { rate: n(r.rate), taxable: n(r.taxable), cgst: n(r.cgst), sgst: n(r.sgst), igst: n(r.igst) }
  return { ...out, tax: n(out.cgst + out.sgst + out.igst) }
}
type Money = ReturnType<typeof money>
const total = (rows: Omit<Money, 'rate'>[]) =>
  rows.reduce((t, r) => ({ taxable: n(t.taxable + r.taxable), cgst: n(t.cgst + r.cgst), sgst: n(t.sgst + r.sgst), igst: n(t.igst + r.igst), tax: n(t.tax + r.tax) }), { taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 })

function range(q: { from?: string; to?: string }) {
  const r = monthRange(q)
  if (r.to < r.from) throw ApiError.badRequest('"To" is before "From"')
  return r
}

export async function gstSummary(q: { from?: string; to?: string }) {
  const { from, to } = range(q)
  const sums = Prisma.sql`SUM(taxable) AS taxable, SUM(cgst) AS cgst, SUM(sgst) AS sgst, SUM(igst) AS igst`
  const [out, inw, kinds] = await Promise.all([
    prisma.$queryRaw<TaxRow[]>`SELECT rate, ${sums} FROM (${OUTWARD}) x WHERE ${inRange(from, to)} GROUP BY rate ORDER BY rate`,
    prisma.$queryRaw<TaxRow[]>`SELECT rate, ${sums} FROM (${INWARD}) x WHERE ${inRange(from, to)} GROUP BY rate ORDER BY rate`,
    prisma.$queryRaw<(TaxRow & { part: string })[]>`SELECT CASE WHEN kind = 'RETURN' THEN 'returns' WHEN COALESCE(gstin, '') <> '' THEN 'b2b' ELSE 'b2c' END AS part,
      0 AS rate, ${sums} FROM (${OUTWARD}) x WHERE ${inRange(from, to)} GROUP BY 1`,
  ])
  const outward = out.map(money), inward = inw.map(money)
  const o = total(outward), i = total(inward)
  const part = (p: string) => money(kinds.find((k) => k.part === p) ?? { rate: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 })
  return {
    from, to,
    outward, outwardTotal: o,
    split: { b2b: part('b2b'), b2c: part('b2c'), returns: part('returns') },
    inward, inwardTotal: i,
    // Simple difference per head — the accountant applies the IGST / CGST / SGST set-off order when filing.
    payable: { cgst: n(o.cgst - i.cgst), sgst: n(o.sgst - i.sgst), igst: n(o.igst - i.igst), total: n(o.tax - i.tax) },
  }
}

type DocRow = TaxRow & { d: Date; ref_id: number; kind: string; doc_no: string; party: string; gstin: string | null; bill_no?: string }
const docRow = (r: DocRow) => {
  const { rate: _ignored, ...m } = money({ ...r, rate: 0 }) // rate here is text like "5.0, 18.0"
  return { date: r.d, refId: r.ref_id, kind: r.kind, docNo: r.doc_no, party: r.party, gstin: r.gstin || null, billNo: r.bill_no ?? null, rates: String(r.rate ?? ''), ...m, total: n(m.taxable + m.tax) }
}

// Bill-wise: one row per bill / job / return (b2b = only customers with GSTIN).
export async function salesRegister(q: { from?: string; to?: string; b2b?: boolean }) {
  const { from, to } = range(q)
  const b2b = q.b2b ? Prisma.sql`AND COALESCE(gstin, '') <> ''` : Prisma.empty
  const rows = await prisma.$queryRaw<DocRow[]>`
    SELECT d, ref_id, kind, doc_no, party, gstin, string_agg(DISTINCT rate::numeric(5,1)::text, ', ') AS rate,
           SUM(taxable) AS taxable, SUM(cgst) AS cgst, SUM(sgst) AS sgst, SUM(igst) AS igst
      FROM (${OUTWARD}) x WHERE ${inRange(from, to)} ${b2b}
      GROUP BY d, ref_id, kind, doc_no, party, gstin ORDER BY d, doc_no`
  const items = rows.map(docRow)
  return { from, to, items, total: total(items) }
}

export async function purchaseRegister(q: { from?: string; to?: string }) {
  const { from, to } = range(q)
  const rows = await prisma.$queryRaw<DocRow[]>`
    SELECT d, ref_id, kind, doc_no, party, gstin, bill_no, string_agg(DISTINCT rate::numeric(5,1)::text, ', ') AS rate,
           SUM(taxable) AS taxable, SUM(cgst) AS cgst, SUM(sgst) AS sgst, SUM(igst) AS igst
      FROM (${INWARD}) x WHERE ${inRange(from, to)}
      GROUP BY d, ref_id, kind, doc_no, party, gstin, bill_no ORDER BY d, doc_no`
  const items = rows.map(docRow)
  return { from, to, items, total: total(items) }
}

// HSN / SAC summary of sales (net of returns).
export async function hsnSummary(q: { from?: string; to?: string }) {
  const { from, to } = range(q)
  const rows = await prisma.$queryRaw<(TaxRow & { hsn: string; qty: Dec })[]>`
    SELECT hsn, rate, SUM(qty) AS qty, SUM(taxable) AS taxable, SUM(cgst) AS cgst, SUM(sgst) AS sgst, SUM(igst) AS igst
      FROM (${OUTWARD}) x WHERE ${inRange(from, to)} GROUP BY hsn, rate ORDER BY hsn, rate`
  const items = rows.map((r) => ({ hsn: r.hsn || '', qty: Number(r.qty ?? 0), ...money(r) }))
  return { from, to, items, total: total(items), missingHsn: items.filter((r) => !r.hsn).length }
}
