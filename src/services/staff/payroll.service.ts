import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import { nextDocNo, todayIST, toDocDate } from '../../utils/financialYear'
import type { PayslipInput } from '../../validators/staff.validator'
import { audit } from '../audit.service'
import { monthDate, monthRows } from './payroll.sheet'

// Payslips (PS/…): one per staff member per month. Paying makes
//   a salary payment (SAL/…)  = salary − advance already paid + bonus − deduction   → salary expense of that month
//   a worker payment (TP/…)   = the per-piece work paid now                         → clears what the shop owed them
// so the day book, profit and accounts need nothing new. Never edited — cancel (both payments are cancelled with it).

const r2 = (n: number) => Math.round(n * 100) / 100
const include = {
  staff: { select: { id: true, code: true, name: true, role: true, dept: true, phone: true } },
  salaryPayment: { select: { id: true, docNo: true, amount: true } },
  tailorPayment: { select: { id: true, docNo: true, amount: true } },
} as const

export async function pay(input: PayslipInput, user: string) {
  const { date, isFuture } = toDocDate(input.docDate)
  if (isFuture) throw ApiError.badRequest("Date can't be in the future")
  if (input.month > todayIST().slice(0, 7)) throw ApiError.badRequest("Salary for a future month can't be paid — give an advance instead")
  const [row] = await monthRows(input.month, [input.staffId])
  if (!row) throw ApiError.badRequest('Staff member not found')
  const s = row.staff
  if (!s.isActive) throw ApiError.badRequest(`${s.name} is inactive — make them active first`)
  if (row.payslip) throw ApiError.conflict(`${s.name}'s ${input.month} salary is already paid (${row.payslip.docNo}) — cancel that payslip to redo it`)
  if (input.deduction > 0 && !input.deductionNote) throw ApiError.badRequest('Write why the deduction (e.g. 2 days leave)')
  const salaryPart = r2(row.salary - row.advance + input.bonus - input.deduction)
  if (salaryPart < 0) throw ApiError.badRequest(`Advance + deduction is more than the salary + bonus by ₹${Math.abs(salaryPart)}`)
  if (input.piecePaid > 0 && !row.isPiece) throw ApiError.badRequest(`${s.name} is not paid per piece`)
  if (input.piecePaid > Math.max(0, row.pieceDue) + 0.004) throw ApiError.badRequest(`Per-piece pay due is only ₹${Math.max(0, row.pieceDue)}`)
  const net = r2(salaryPart + input.piecePaid)
  if (net <= 0 && row.salary <= 0) throw ApiError.badRequest('Nothing to pay')

  const id = await prisma.$transaction(async (tx) => {
    const docNo = await nextDocNo(tx, 'PS', date)
    const note = `Payslip ${docNo}`
    const sp = salaryPart > 0
      ? await tx.salaryPayment.create({ data: { docNo: await nextDocNo(tx, 'SAL', date), staffId: s.id, docDate: date, month: monthDate(input.month), amount: salaryPart, mode: input.mode, reference: input.reference, notes: note, createdBy: user } })
      : null
    const tp = input.piecePaid > 0
      ? await tx.tailorPayment.create({ data: { docNo: await nextDocNo(tx, 'TP', date), tailorId: row.workerId!, docDate: date, amount: input.piecePaid, mode: input.mode, reference: input.reference, notes: `${note} (${input.month})`, createdBy: user } })
      : null
    const p = await tx.payslip.create({
      data: {
        docNo, staffId: s.id, month: monthDate(input.month), docDate: date,
        salary: row.salary, advance: row.advance, bonus: input.bonus, deduction: input.deduction, deductionNote: input.deductionNote,
        pieceEarned: row.pieceEarned, piecePieces: row.piecePieces, pieceBefore: row.pieceBefore, piecePaid: input.piecePaid, netPaid: net,
        mode: input.mode, reference: input.reference, notes: input.notes, work: row.work, salaryPaymentId: sp?.id, tailorPaymentId: tp?.id, createdBy: user,
      },
    })
    await audit(tx, { actor: user, action: 'payslip.pay', entity: 'payslip', entityId: p.id, summary: `${docNo} ${s.name} — ${input.month} paid ₹${net} (${input.mode})` })
    return p.id
  })
  return getPayslip(id)
}

export async function cancelPayslip(id: number, reason: string, user: string) {
  await prisma.$transaction(async (tx) => {
    const p = await tx.payslip.findUnique({ where: { id } })
    if (!p) throw ApiError.notFound('Payslip not found')
    const done = await tx.payslip.updateMany({ where: { id, status: 'POSTED' }, data: { status: 'CANCELLED', cancelledBy: user, cancelledAt: new Date(), cancelReason: reason } })
    if (done.count === 0) throw ApiError.conflict(`${p.docNo} is already cancelled`)
    const cancel = { status: 'CANCELLED' as const, cancelledBy: user, cancelledAt: new Date(), cancelReason: `${p.docNo} cancelled — ${reason}`.slice(0, 255) }
    if (p.salaryPaymentId) await tx.salaryPayment.updateMany({ where: { id: p.salaryPaymentId, status: 'POSTED' }, data: cancel })
    if (p.tailorPaymentId) await tx.tailorPayment.updateMany({ where: { id: p.tailorPaymentId, status: 'POSTED' }, data: cancel })
    await audit(tx, { actor: user, action: 'payslip.cancel', entity: 'payslip', entityId: id, summary: `${p.docNo} cancelled — ${reason}` })
  })
  return getPayslip(id)
}

export async function getPayslip(id: number) {
  const p = await prisma.payslip.findUnique({ where: { id }, include })
  if (!p) throw ApiError.notFound('Payslip not found')
  return p
}

// Salary / worker payments made by a payslip are cancelled only with the payslip.
export async function assertNotOnPayslip(where: { salaryPaymentId: number } | { tailorPaymentId: number }) {
  const p = await prisma.payslip.findFirst({ where: { ...where, status: 'POSTED' }, select: { docNo: true } })
  if (p) throw ApiError.conflict(`This payment is part of payslip ${p.docNo} — cancel the payslip instead`)
}
