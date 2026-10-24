import { prisma } from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { calcJob, materialForCalc } from '../jobs/job.calc'
import { monthRange } from './workshop.report'

// Reports → "Profit by item": each garment / product with pieces, income before GST and what it cost.
//   STITCHING  jobs booked in the dates (not cancelled) — same figures as Job profit, split over the garments by their charge
//   SALE       items sold: counter bills + items sold on jobs, less returns (cost = average stock cost when sold)
//   BRAND      brand-order pieces on delivery bills in the dates (cloth from our stock, stitching pay, other work)
// Job / order costs not tied to one piece are shared over its pieces by their charge.

export type ItemKind = 'STITCHING' | 'SALE' | 'BRAND'
type Acc = { kind: ItemKind; item: string; pieces: number; total: number; tailor: number; embroidery: number; other: number; cloth: number }

const r2 = (n: number) => Math.round(n * 100) / 100
const isEmbroidery = (name: string) => /embroid/i.test(name)

function bucket(map: Map<string, Acc>, kind: ItemKind, item: string) {
  const key = `${kind}|${item}`
  let a = map.get(key)
  if (!a) map.set(key, (a = { kind, item, pieces: 0, total: 0, tailor: 0, embroidery: 0, other: 0, cloth: 0 }))
  return a
}
// Share of each piece line in its job / order (by charge; equal when nothing is charged).
const shares = (vals: number[]) => {
  const sum = vals.reduce((s, v) => s + v, 0)
  return vals.map((v) => (sum > 0 ? v / sum : 1 / vals.length))
}

async function stitching(map: Map<string, Acc>, from: string, to: string) {
  const jobs = await prisma.stitchingJob.findMany({
    where: { status: { not: 'CANCELLED' }, docDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
    include: { items: { include: { garmentType: { select: { name: true } } } }, materials: true, costs: true, costEntries: { include: { category: { select: { name: true } } } } },
  })
  for (const j of jobs) {
    if (!j.items.length) continue
    const { cost } = calcJob({
      items: j.items.map((i) => ({ qty: i.qty, chargeRate: Number(i.chargeRate), labourRate: Number(i.labourRate) })),
      materials: j.materials.map(materialForCalc),
      costs: j.costs.map((c) => ({ charge: Number(c.charge) })),
      entries: j.costEntries.map((e) => ({ amount: Number(e.amount) })),
      discount: Number(j.discount), gstRate: Number(j.gstRate), taxMode: j.taxMode,
    })
    const share = shares(j.items.map((i) => i.qty * Number(i.chargeRate)))
    j.items.forEach((i, n) => {
      const a = bucket(map, 'STITCHING', i.garmentType.name)
      a.pieces += i.qty
      a.total += cost.charged * share[n]
      a.tailor += i.qty * Number(i.labourRate)
      a.cloth += cost.materialCost * share[n]
      for (const e of j.costEntries) {
        const amt = Number(e.amount) * (e.jobItemId ? (e.jobItemId === i.id ? 1 : 0) : share[n])
        if (isEmbroidery(e.category.name)) a.embroidery += amt
        else a.other += amt
      }
    })
  }
}

type SaleRow = { item: string; pieces: Prisma.Decimal; total: Prisma.Decimal; cost: Prisma.Decimal }
async function sales(map: Map<string, Acc>, from: string, to: string) {
  const rows = await prisma.$queryRaw<SaleRow[]>`
    SELECT p.name AS item, SUM(x.qty - x.returned) AS pieces, SUM(x.taxable * (x.qty - x.returned) / NULLIF(x.qty, 0)) AS total, SUM((x.qty - x.returned) * x.unit_cost) AS cost
    FROM (SELECT l.variant_id, l.qty, l.returned_qty AS returned, l.taxable, l.unit_cost FROM sales_lines l JOIN sales_invoices s ON s.id = l.invoice_id
            WHERE s.status = 'POSTED' AND s.doc_date BETWEEN ${from}::date AND ${to}::date
          UNION ALL SELECT m.variant_id, m.qty, m.returned_qty, m.taxable, m.unit_cost FROM job_materials m JOIN stitching_jobs j ON j.id = m.job_id
            WHERE NOT m.included AND j.status <> 'CANCELLED' AND j.doc_date BETWEEN ${from}::date AND ${to}::date) x
    JOIN product_variants v ON v.id = x.variant_id JOIN products p ON p.id = v.product_id
    GROUP BY p.name HAVING SUM(x.qty - x.returned) <> 0`
  for (const r of rows) {
    const a = bucket(map, 'SALE', r.item)
    a.pieces += Number(r.pieces)
    a.total += Number(r.total ?? 0)
    a.cloth += Number(r.cost ?? 0)
  }
}

async function brand(map: Map<string, Acc>, from: string, to: string) {
  const orders = await prisma.brandOrder.findMany({
    where: { status: { not: 'CANCELLED' }, items: { some: { bill: { status: 'POSTED', docDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } } } } },
    include: {
      items: { include: { garmentType: { select: { name: true } }, materials: true, bill: { select: { status: true, docDate: true, gstRate: true } } } },
      costs: { include: { category: { select: { name: true } } } },
    },
  })
  const inRange = (d: Date) => d.toISOString().slice(0, 10) >= from && d.toISOString().slice(0, 10) <= to
  for (const o of orders) {
    const value = (i: (typeof o.items)[number]) => i.qty * Number(i.chargeRate) + i.materials.reduce((s, m) => s + Number(m.amount), 0)
    const share = shares(o.items.map(value))
    o.items.forEach((i, n) => {
      if (!i.bill || i.bill.status !== 'POSTED' || !inRange(i.bill.docDate)) return
      const a = bucket(map, 'BRAND', i.garmentType.name)
      a.pieces += i.qty
      a.total += value(i) / (1 + Number(i.bill.gstRate) / 100)
      a.tailor += i.qty * Number(i.labourRate)
      a.cloth += i.materials.reduce((s, m) => s + Number(m.qty) * Number(m.unitCost), 0)
      for (const c of o.costs) {
        const amt = Number(c.amount) * (c.itemId ? (c.itemId === i.id ? 1 : 0) : share[n])
        if (isEmbroidery(c.category.name)) a.embroidery += amt
        else a.other += amt
      }
    })
  }
}

export async function itemProfit(q: { from?: string; to?: string; kind?: ItemKind }) {
  const { from, to } = monthRange(q)
  const map = new Map<string, Acc>()
  await Promise.all([
    !q.kind || q.kind === 'STITCHING' ? stitching(map, from, to) : null,
    !q.kind || q.kind === 'SALE' ? sales(map, from, to) : null,
    !q.kind || q.kind === 'BRAND' ? brand(map, from, to) : null,
  ])
  const rows = [...map.values()].map((a) => {
    const cost = a.tailor + a.embroidery + a.other + a.cloth
    return {
      kind: a.kind, item: a.item, pieces: r2(a.pieces), avgRate: a.pieces ? r2(a.total / a.pieces) : 0, total: r2(a.total),
      tailor: r2(a.tailor), embroidery: r2(a.embroidery), other: r2(a.other), cloth: r2(a.cloth), profit: r2(a.total - cost),
      marginPct: a.total > 0 ? r2(((a.total - cost) / a.total) * 100) : 0,
    }
  }).sort((x, y) => y.total - x.total || x.item.localeCompare(y.item))
  const sum = (k: 'pieces' | 'total' | 'tailor' | 'embroidery' | 'other' | 'cloth' | 'profit') => r2(rows.reduce((s, r) => s + r[k], 0))
  const totals = { pieces: sum('pieces'), total: sum('total'), tailor: sum('tailor'), embroidery: sum('embroidery'), other: sum('other'), cloth: sum('cloth'), profit: sum('profit') }
  return { from, to, kind: q.kind ?? null, rows, totals }
}
