import { prisma } from '../../config/prisma'
import { earnedRows, extraPayRows } from '../workshop/tailor.statement'
import { workersOf } from './staff.worker'

// Monthly salary sheet: for each staff member in a month —
//   salary part   = monthly salary − leave cut − advance already paid for that month (salary payments without a payslip)
//   leave cut     = salary ÷ 30 × leave days of the month (same day rate every month; every leave day is cut)
//   paid per day  = "salary" is day rate × days worked of the month (no leave cut)
//   per-piece part = what their job work earned up to the month end − everything paid to them so far (worker payments)
//                    (shown as: earned this month + older balance; older balance is minus when they took an advance)
//                    salaried people: only extra pay typed for them on a brand order, minus what was paid since it began
// Money itself is never stored here — paying makes a payslip (payroll.service.ts).

const r2 = (n: number) => Math.round(n * 100) / 100
// One month's leave cut: a day is 1/30 of the monthly salary.
export const leaveCutOf = (salary: number, days: number) => r2((salary / 30) * days)
export const monthDate = (m: string) => new Date(`${m}-01T00:00:00Z`)
const lastDay = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10)

export type WorkLine = { docNo: string; date: string; detail: string; pieces: number; amount: number }

export async function monthRows(month: string, staffIds?: number[]) {
  const m = monthDate(month)
  const to = lastDay(month)
  const staff = await prisma.staff.findMany({
    where: {
      ...(staffIds ? { id: { in: staffIds } } : {}),
      OR: [{ isActive: true, OR: [{ joinDate: null }, { joinDate: { lte: new Date(`${to}T00:00:00Z`) } }] }, { payslips: { some: { month: m, status: 'POSTED' } } }],
    },
    orderBy: { name: 'asc' },
    select: { id: true, code: true, name: true, role: true, dept: true, salary: true, dayRate: true, isActive: true },
  })
  const ids = staff.map((s) => s.id)
  const [workers, payslips, advances, leaves, workDays] = await Promise.all([
    workersOf(ids),
    prisma.payslip.findMany({ where: { month: m, status: 'POSTED', staffId: { in: ids } }, select: { id: true, docNo: true, staffId: true, netPaid: true, docDate: true } }),
    prisma.salaryPayment.findMany({ where: { month: m, status: 'POSTED', staffId: { in: ids }, payslip: null }, select: { staffId: true, amount: true } }),
    prisma.staffLeave.findMany({ where: { month: m, staffId: { in: ids } }, select: { staffId: true, days: true } }),
    prisma.staffWorkDays.findMany({ where: { month: m, staffId: { in: ids } }, select: { staffId: true, days: true } }),
  ])
  const piece = [...workers.values()].filter((w) => w.payType === 'PIECE')
  const tailorIds = piece.map((w) => w.id)
  const [earned, paid] = tailorIds.length
    ? await Promise.all([
        earnedRows({ tailorIds, to }),
        prisma.tailorPayment.groupBy({ by: ['tailorId'], where: { tailorId: { in: tailorIds }, status: 'POSTED' }, _sum: { amount: true } }),
      ])
    : [[], []]
  const salariedIds = [...workers.values()].filter((w) => w.payType === 'SALARY').map((w) => w.id)
  const extras = salariedIds.length ? await extraPayRows({ tailorIds: salariedIds, to }) : []
  const extraPaid = extras.length ? await prisma.tailorPayment.findMany({ where: { tailorId: { in: [...new Set(extras.map((e) => e.tailor_id))] }, status: 'POSTED' }, select: { tailorId: true, docDate: true, amount: true } }) : []

  return staff.map((s) => {
    const dayRate = Number(s.dayRate)
    const workedDays = dayRate > 0 ? Number(workDays.find((d) => d.staffId === s.id)?.days ?? 0) : 0
    const salary = dayRate > 0 ? r2(dayRate * workedDays) : Number(s.salary)
    const advance = r2(advances.filter((a) => a.staffId === s.id).reduce((t, a) => t + Number(a.amount), 0))
    const w = workers.get(s.id)
    const myExtras = w ? extras.filter((e) => e.tailor_id === w.id) : []
    const isPiece = w?.payType === 'PIECE' || myExtras.length > 0
    let pieceEarned = 0, piecePieces = 0, pieceDue = 0
    const work: WorkLine[] = []
    if (w && isPiece) {
      const mine = w.payType === 'PIECE' ? earned.filter((e) => e.tailor_id === w.id) : myExtras
      const upTo = mine.reduce((t, e) => t + Number(e.labour), 0)
      for (const e of mine.filter((x) => x.earned_on.toISOString().slice(0, 7) === month)) {
        work.push({ docNo: e.doc_no, date: e.earned_on.toISOString().slice(0, 10), detail: e.garments, pieces: e.pieces, amount: r2(Number(e.labour)) })
        pieceEarned += Number(e.labour)
        piecePieces += e.pieces
      }
      pieceDue = w.payType === 'PIECE'
        ? r2(Number(w.openingBalance) + upTo - Number(paid.find((p) => p.tailorId === w.id)?._sum.amount ?? 0))
        : r2(upTo - extraPaid.filter((p) => p.tailorId === w.id && p.docDate >= mine[0].earned_on).reduce((t, p) => t + Number(p.amount), 0))
    }
    pieceEarned = r2(pieceEarned)
    const leaveDays = dayRate > 0 ? 0 : Number(leaves.find((l) => l.staffId === s.id)?.days ?? 0)
    const leaveCut = leaveCutOf(salary, leaveDays)
    const salaryDue = r2(Math.max(0, salary - leaveCut - advance))
    return {
      staff: s,
      salary, dayRate, workedDays, leaveDays, leaveCut, advance, salaryDue,
      isPiece, workerId: w?.id ?? null, pieceEarned, piecePieces, pieceBefore: r2(pieceDue - pieceEarned), pieceDue, work,
      toPay: r2(salaryDue + Math.max(0, pieceDue)),
      payslip: payslips.find((p) => p.staffId === s.id) ?? null,
    }
  })
}

export async function monthSheet(month: string) {
  const rows = await monthRows(month)
  const sum = (f: (r: (typeof rows)[number]) => number) => r2(rows.reduce((t, r) => t + f(r), 0))
  return {
    month,
    rows,
    totals: { toPay: sum((r) => (r.payslip ? 0 : r.toPay)), paid: sum((r) => Number(r.payslip?.netPaid ?? 0)), people: rows.length, done: rows.filter((r) => r.payslip).length },
  }
}
