import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import { todayIST } from '../../utils/financialYear'
import type { LeaveInput, WorkDaysInput } from '../../validators/staff.validator'
import { audit } from '../audit.service'
import { monthDate } from './payroll.sheet'

// Leave days of one staff member for one month, typed in the Monthly salary list. Only the days are saved here —
// the cut (leaveCutOf) is worked out on the sheet and becomes money only when the payslip is made.
// A paid month is closed: cancel the payslip to change its leave.

export async function setLeave({ staffId, month, days }: LeaveInput, user: string) {
  if (month > todayIST().slice(0, 7)) throw ApiError.badRequest("Leave for a future month can't be entered")
  const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { name: true, salary: true } })
  if (!staff) throw ApiError.badRequest('Staff member not found')
  if (!(Number(staff.salary) > 0)) throw ApiError.badRequest(`${staff.name} has no monthly salary — leave is not cut for them`)
  const m = monthDate(month)
  const paid = await prisma.payslip.findFirst({ where: { staffId, month: m, status: 'POSTED' }, select: { docNo: true } })
  if (paid) throw ApiError.conflict(`${staff.name}'s ${month} salary is already paid (${paid.docNo}) — cancel that payslip to change the leave`)
  await prisma.$transaction(async (tx) => {
    if (days > 0) await tx.staffLeave.upsert({ where: { staffId_month: { staffId, month: m } }, create: { staffId, month: m, days, updatedBy: user }, update: { days, updatedBy: user } })
    else await tx.staffLeave.deleteMany({ where: { staffId, month: m } })
    await audit(tx, { actor: user, action: 'payroll.leave', entity: 'staff', entityId: staffId, summary: `${staff.name} — ${month} leave: ${days} day${days === 1 ? '' : 's'}` })
  })
}

// Days worked by someone paid per day, typed in the same list. Pay = day rate × days; a paid month is closed too.
export async function setWorkDays({ staffId, month, days }: WorkDaysInput, user: string) {
  if (month > todayIST().slice(0, 7)) throw ApiError.badRequest("Days for a future month can't be entered")
  const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { name: true, dayRate: true } })
  if (!staff) throw ApiError.badRequest('Staff member not found')
  if (!(Number(staff.dayRate) > 0)) throw ApiError.badRequest(`${staff.name} is not paid per day`)
  const m = monthDate(month)
  const paid = await prisma.payslip.findFirst({ where: { staffId, month: m, status: 'POSTED' }, select: { docNo: true } })
  if (paid) throw ApiError.conflict(`${staff.name}'s ${month} pay is already paid (${paid.docNo}) — cancel that payslip to change the days`)
  await prisma.$transaction(async (tx) => {
    if (days > 0) await tx.staffWorkDays.upsert({ where: { staffId_month: { staffId, month: m } }, create: { staffId, month: m, days, updatedBy: user }, update: { days, updatedBy: user } })
    else await tx.staffWorkDays.deleteMany({ where: { staffId, month: m } })
    await audit(tx, { actor: user, action: 'payroll.days', entity: 'staff', entityId: staffId, summary: `${staff.name} — ${month} days worked: ${days}` })
  })
}
