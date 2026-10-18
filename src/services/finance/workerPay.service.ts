import { prisma } from '../../config/prisma'
import { monthRange } from '../reports/workshop.report'
import { earnedRows } from '../workshop/tailor.statement'

// Expenses (all costs list): the per-piece worker pay behind "Worker pay (per piece)" in profit & loss — one row per worker per
// job (the day the job got Ready): which job, for which customer, what work, who, how much. Same rule as the P&L
// (stitching jobs + brand orders, per-piece workers only), so the rows always add up to that line.

const r2 = (n: number) => Math.round(n * 100) / 100

export async function workerPayRows(q: { from?: string; to?: string }) {
  const { from, to } = monthRange(q)
  const [earned, piece] = await Promise.all([
    earnedRows({ from, to, kind: ['JOB', 'BRD'] }),
    prisma.tailor.findMany({ where: { payType: 'PIECE' }, select: { id: true, name: true } }),
  ])
  const names = new Map(piece.map((t) => [t.id, t.name]))
  const mine = earned.filter((e) => names.has(e.tailor_id) && Number(e.labour) !== 0)
  const ids = (kind: string) => [...new Set(mine.filter((e) => e.kind === kind).map((e) => e.job_id))]
  const [jobs, orders] = await Promise.all([
    prisma.stitchingJob.findMany({ where: { id: { in: ids('JOB') } }, select: { id: true, customerName: true } }),
    prisma.brandOrder.findMany({ where: { id: { in: ids('BRD') } }, select: { id: true, brandName: true } }),
  ])
  const customer = new Map<string, string>([...jobs.map((j) => [`JOB${j.id}`, j.customerName] as const), ...orders.map((o) => [`BRD${o.id}`, o.brandName] as const)])
  const rows = mine
    .map((e) => ({
      date: e.earned_on, kind: e.kind, jobId: e.job_id, docNo: e.doc_no, customerName: customer.get(`${e.kind}${e.job_id}`) ?? '', work: e.garments,
      workerId: e.tailor_id, worker: names.get(e.tailor_id)!, pieces: e.pieces, amount: r2(Number(e.labour)),
    }))
    .sort((a, b) => b.date.getTime() - a.date.getTime() || b.jobId - a.jobId)
  return { from, to, rows, total: r2(rows.reduce((s, r) => s + r.amount, 0)) }
}

