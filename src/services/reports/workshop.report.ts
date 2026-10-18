import { prisma } from '../../config/prisma'
import { todayIST } from '../../utils/financialYear'
import { calcJob, materialForCalc } from '../jobs/job.calc'
import { balances, earnedRows } from '../workshop/tailor.statement'

// Workshop reports (SRS 18: tailor-wise workload and labour cost, job-wise profitability).

const r2 = (n: number) => Math.round(n * 100) / 100

// Default = this month so far.
export function monthRange(q: { from?: string; to?: string }) {
  const today = todayIST()
  return { from: q.from ?? `${today.slice(0, 8)}01`, to: q.to ?? today }
}

// Per tailor: jobs / pieces / labour earned in the period (by the day the job got Ready), paid in the period, balance now.
export async function tailorWork(q: { from?: string; to?: string }) {
  const { from, to } = monthRange(q)
  const [tailors, earned, paid] = await Promise.all([
    prisma.tailor.findMany({ orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, payType: true, isActive: true, openingBalance: true } }),
    earnedRows({ from, to }),
    prisma.tailorPayment.groupBy({ by: ['tailorId'], where: { status: 'POSTED', docDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } }, _sum: { amount: true } }),
  ])
  const all = await balances(tailors.map((t) => t.id))
  const rows = tailors.map((t) => {
    const mine = earned.filter((e) => e.tailor_id === t.id)
    const b = all.get(t.id)!
    return {
      id: t.id, code: t.code, name: t.name, payType: t.payType,
      jobs: mine.length,
      pieces: mine.reduce((s, e) => s + e.pieces, 0),
      labour: r2(mine.reduce((s, e) => s + Number(e.labour), 0)),
      paid: Number(paid.find((p) => p.tailorId === t.id)?._sum.amount ?? 0),
      balance: t.payType === 'PIECE' ? r2(Number(t.openingBalance) + b.earned - b.paid) : null,
      isActive: t.isActive,
    }
  }).filter((r) => r.isActive || r.jobs || r.paid || (r.balance ?? 0) !== 0)
  const totals = { jobs: rows.reduce((s, r) => s + r.jobs, 0), pieces: rows.reduce((s, r) => s + r.pieces, 0), labour: r2(rows.reduce((s, r) => s + r.labour, 0)), paid: r2(rows.reduce((s, r) => s + r.paid, 0)) }
  return { from, to, rows: rows.sort((a, b) => b.labour - a.labour || a.name.localeCompare(b.name)), totals }
}

// Jobs booked in the period (not cancelled): STITCHING charged (before GST) vs its cost; split by garment type.
// Items the customer paid for on a job bill are a shop sale — not in the job profit.
export async function jobProfit(q: { from?: string; to?: string }) {
  const { from, to } = monthRange(q)
  const jobs = await prisma.stitchingJob.findMany({
    where: { status: { not: 'CANCELLED' }, docDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
    include: { items: { include: { garmentType: { select: { name: true } } } }, materials: true, costs: true, costEntries: { select: { amount: true } } },
  })
  const t = { jobs: jobs.length, delivered: 0, charged: 0, gst: 0, materialCost: 0, labourCost: 0, otherCost: 0, costTotal: 0, profit: 0 }
  const byGarment = new Map<string, { garment: string; pieces: number; charge: number; labour: number }>()
  // Profit of each job (stitching charged before GST − tailor − job costs − cloth used free), lowest first.
  const perJob: { id: number; docNo: string; docDate: Date; customerName: string; status: string; charged: number; labour: number; other: number; material: number; cost: number; profit: number; marginPct: number }[] = []
  for (const j of jobs) {
    const { cost } = calcJob({
      items: j.items.map((i) => ({ qty: i.qty, chargeRate: Number(i.chargeRate), labourRate: Number(i.labourRate) })),
      materials: j.materials.map(materialForCalc),
      costs: j.costs.map((c) => ({ charge: Number(c.charge) })),
      entries: j.costEntries.map((e) => ({ amount: Number(e.amount) })),
      discount: Number(j.discount), gstRate: Number(j.gstRate), taxMode: j.taxMode,
    })
    if (j.status === 'DELIVERED') t.delivered++
    t.charged += cost.charged
    t.gst += cost.chargedGst
    t.materialCost += cost.materialCost
    t.labourCost += cost.labourCost
    t.otherCost += cost.otherCost
    const charged = cost.charged // stitching only (items sold on the bill are a shop sale)
    const jobCost = cost.materialCost + cost.labourCost + cost.otherCost
    perJob.push({
      id: j.id, docNo: j.docNo, docDate: j.docDate, customerName: j.customerName, status: j.status,
      charged: r2(charged), labour: r2(cost.labourCost), other: r2(cost.otherCost), material: r2(cost.materialCost), cost: r2(jobCost),
      profit: r2(charged - jobCost), marginPct: charged > 0 ? r2(((charged - jobCost) / charged) * 100) : 0,
    })
    for (const i of j.items) {
      const g = byGarment.get(i.garmentType.name) ?? { garment: i.garmentType.name, pieces: 0, charge: 0, labour: 0 }
      g.pieces += i.qty
      g.charge += i.qty * Number(i.chargeRate)
      g.labour += i.qty * Number(i.labourRate)
      byGarment.set(g.garment, g)
    }
  }
  t.costTotal = t.materialCost + t.labourCost + t.otherCost
  t.profit = t.charged - t.costTotal
  const totals = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, r2(v)])) as typeof t
  const garments = [...byGarment.values()].map((g) => ({ ...g, charge: r2(g.charge), labour: r2(g.labour) })).sort((a, b) => b.charge - a.charge)
  const jobRows = perJob.sort((a, b) => a.profit - b.profit || a.docNo.localeCompare(b.docNo))
  return { from, to, totals: { ...totals, marginPct: totals.charged > 0 ? r2((totals.profit / totals.charged) * 100) : 0 }, garments, jobs: jobRows }
}

// Direct expenses of the workshop in a period: tailor fees (earned when jobs got Ready), shop material used for
// stitching (stock cost), and job cost entries by type. Salaried amounts are costing only — salary is paid via payroll.
export async function directExpenses(q: { from?: string; to?: string }) {
  const { from, to } = monthRange(q)
  const range = { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) }
  const [earned, used, entries, cats, delivered] = await Promise.all([
    earnedRows({ from, to, kind: 'JOB' }),
    prisma.$queryRaw<{ cost: unknown }[]>`
      SELECT COALESCE(SUM(m.qty * m.unit_cost), 0) AS cost FROM job_materials m JOIN stitching_jobs j ON j.id = m.job_id
      WHERE m.included AND j.status <> 'CANCELLED' AND (m.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date`,
    prisma.jobCostEntry.groupBy({ by: ['categoryId', 'paidBy'], where: { date: range, job: { status: { not: 'CANCELLED' } } }, _sum: { amount: true } }),
    prisma.jobCostCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true } }),
    // Delivered in the period but no cost at all → the cost was probably not entered yet.
    prisma.stitchingJob.findMany({
      where: { status: 'DELIVERED', deliveredAt: { gte: range.gte, lt: new Date(range.lte.getTime() + 86_400_000) }, costEntries: { none: {} }, materials: { none: { included: true } }, items: { none: { tailorId: { not: null } } } },
      select: { id: true, docNo: true, customerName: true, grandTotal: true }, orderBy: { id: 'asc' }, take: 100,
    }),
  ])
  const rows = [
    { name: 'Worker pay (per piece — stitching + work by our workers)', salaried: 0, paid: r2(earned.reduce((s, e) => s + Number(e.labour), 0)) },
    { name: 'Material used from stock', salaried: 0, paid: r2(Number(used[0]?.cost ?? 0)) },
    ...cats.map((c) => {
      const sum = (p: 'SALARIED' | 'PAID') => Number(entries.find((e) => e.categoryId === c.id && e.paidBy === p)?._sum.amount ?? 0)
      return { name: c.name, salaried: r2(sum('SALARIED')), paid: r2(sum('PAID')) }
    }),
  ].map((r) => ({ ...r, total: r2(r.salaried + r.paid) })).filter((r) => r.total > 0)
  const totals = { salaried: r2(rows.reduce((s, r) => s + r.salaried, 0)), paid: r2(rows.reduce((s, r) => s + r.paid, 0)), total: r2(rows.reduce((s, r) => s + r.total, 0)) }
  return { from, to, rows, totals, missingCosts: delivered }
}
