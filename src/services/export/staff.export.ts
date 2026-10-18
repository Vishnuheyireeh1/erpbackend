import { byDate } from '../../utils/order'
import type { Response } from 'express'
import { prisma } from '../../config/prisma'
import { filterText, inBatches, sendExcel, type ExcelColumn } from '../../utils/excel'
import type { SalaryListQuery, StaffListQuery } from '../../validators/staff.validator'
import { monthSheet } from '../staff/payroll.sheet'
import { paymentWhere } from '../staff/salary.service'
import { staffWhere } from '../staff/staff.service'

export async function exportStaff(res: Response, q: Omit<StaffListQuery, 'page' | 'pageSize'>, user: string) {
  const where = staffWhere(q)
  const fetch = (skip: number, take: number) => prisma.staff.findMany({ where, orderBy: { name: 'asc' }, skip, take })
  type Row = Awaited<ReturnType<typeof fetch>>[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Code', value: (s) => s.code, width: 9 },
    { header: 'Name', value: (s) => s.name, width: 24 },
    { header: 'Work', value: (s) => s.role, width: 18 },
    { header: 'Section', value: (s) => (s.dept === 'WORKSHOP' ? 'Workshop' : 'Shop'), width: 11 },
    { header: 'Phone', value: (s) => s.phone, width: 14 },
    { header: 'Monthly salary', value: (s) => s.salary, type: 'money' },
    { header: 'Joined on', value: (s) => s.joinDate, type: 'date', width: 13 },
    { header: 'Address', value: (s) => s.address, width: 30 },
    { header: 'Status', value: (s) => (s.isActive ? 'Active' : 'Inactive'), width: 10 },
    { header: 'Notes', value: (s) => s.notes, width: 26 },
  ]
  const filters = filterText([['Status', q.status], ['Search', q.search]])
  return sendExcel(res, { fileName: 'staff', title: 'Staff', filters, columns, rows: inBatches(fetch), user })
}

export async function exportSalaries(res: Response, q: Omit<SalaryListQuery, 'page' | 'pageSize'>, user: string) {
  const where = paymentWhere(q)
  const fetch = (skip: number, take: number) =>
    prisma.salaryPayment.findMany({ where, orderBy: byDate(q.order), skip, take, include: { staff: { select: { code: true, name: true, role: true } } } })
  type Row = Awaited<ReturnType<typeof fetch>>[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Salary no', value: (p) => p.docNo, width: 20 },
    { header: 'Paid on', value: (p) => p.docDate, type: 'date', width: 13 },
    { header: 'Salary for', value: (p) => p.month.toISOString().slice(0, 7), width: 11 },
    { header: 'Staff', value: (p) => `${p.staff.code} ${p.staff.name}`, width: 24 },
    { header: 'Work', value: (p) => p.staff.role, width: 16 },
    { header: 'Paid by', value: (p) => p.mode, width: 10 },
    { header: 'Amount', value: (p) => p.amount, type: 'money' },
    { header: 'Reference', value: (p) => p.reference, width: 16 },
    { header: 'Status', value: (p) => (p.status === 'POSTED' ? 'Posted' : 'Cancelled'), width: 11 },
    { header: 'Notes', value: (p) => p.notes, width: 26 },
  ]
  const filters = filterText([['Status', q.status], ['Month', q.month], ['Search', q.search], ['From', q.from], ['To', q.to]])
  return sendExcel(res, { fileName: 'salary-payments', title: 'Salary paid', filters, columns, rows: inBatches(fetch), user })
}

// Monthly salary sheet (Staff & salary → Monthly salary).
export async function exportPayroll(res: Response, month: string, user: string) {
  const { rows } = await monthSheet(month)
  type Row = (typeof rows)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Code', value: (r) => r.staff.code, width: 9 },
    { header: 'Name', value: (r) => r.staff.name, width: 24 },
    { header: 'Work', value: (r) => r.staff.role, width: 16 },
    { header: 'Monthly salary', value: (r) => r.salary, type: 'money' },
    { header: 'Advance paid', value: (r) => r.advance, type: 'money' },
    { header: 'Per-piece pieces', value: (r) => (r.isPiece ? r.piecePieces : null), width: 10 },
    { header: 'Per-piece earned', value: (r) => (r.isPiece ? r.pieceEarned : null), type: 'money' },
    { header: 'Per-piece due', value: (r) => (r.isPiece ? r.pieceDue : null), type: 'money' },
    { header: 'To pay', value: (r) => (r.payslip ? null : r.toPay), type: 'money' },
    { header: 'Paid', value: (r) => (r.payslip ? r.payslip.netPaid : null), type: 'money' },
    { header: 'Payslip', value: (r) => r.payslip?.docNo ?? '', width: 20 },
  ]
  return sendExcel(res, { fileName: `salary-${month}`, title: `Monthly salary ${month}`, filters: [`Month: ${month}`], columns, rows: [rows], user })
}
