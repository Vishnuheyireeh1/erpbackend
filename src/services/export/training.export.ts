import { byDate } from '../../utils/order'
import type { Response } from 'express'
import { prisma } from '../../config/prisma'
import { filterText, inBatches, sendExcel, type ExcelColumn } from '../../utils/excel'
import type { TrainingListQuery } from '../../validators/training.validator'
import { receiptWhere } from '../training/fee.service'
import { pendingFees, studentWhere } from '../training/student.service'

type Q = Omit<TrainingListQuery, 'page' | 'pageSize'>
const filters = (q: Q) => filterText([['Status', q.status], ['Search', q.search], ['From', q.from], ['To', q.to]])
const statusText = { STUDYING: 'Studying', COMPLETED: 'Completed', DROPPED: 'Left' } as const

// One row per student per course.
export async function exportStudents(res: Response, q: Q, user: string) {
  const where = { student: studentWhere(q), ...(q.batchId ? { batchId: q.batchId } : {}) }
  const fetch = (skip: number, take: number) =>
    prisma.enrolment.findMany({ where, orderBy: [{ student: { name: 'asc' } }, { id: 'asc' }], skip, take, include: { student: true, batch: { include: { course: true } }, receipts: { where: { status: 'POSTED' }, select: { amount: true } } } })
  type Row = Awaited<ReturnType<typeof fetch>>[number]
  const paid = (r: Row) => r.receipts.reduce((s, x) => s + Number(x.amount), 0)
  const columns: ExcelColumn<Row>[] = [
    { header: 'Code', value: (r) => r.student.code, width: 9 },
    { header: 'Student', value: (r) => r.student.name, width: 24 },
    { header: 'Phone', value: (r) => r.student.phone, width: 14 },
    { header: 'Parent phone', value: (r) => r.student.guardianPhone, width: 14 },
    { header: 'Course', value: (r) => r.batch.course.name, width: 22 },
    { header: 'Batch', value: (r) => r.batch.name, width: 20 },
    { header: 'Joined', value: (r) => r.joinedOn, type: 'date', width: 13 },
    { header: 'Status', value: (r) => statusText[r.status], width: 11 },
    { header: 'Fee', value: (r) => r.fee, type: 'money' },
    { header: 'Paid', value: (r) => paid(r), type: 'money' },
    { header: 'Due', value: (r) => (r.status === 'DROPPED' ? 0 : Math.max(0, Number(r.fee) - paid(r))), type: 'money' },
    { header: 'Address', value: (r) => r.student.address, width: 28 },
  ]
  return sendExcel(res, { fileName: 'students', title: 'Students', filters: filters(q), columns, rows: inBatches(fetch), user })
}

export async function exportPending(res: Response, q: Q, user: string) {
  const p = await pendingFees(q)
  type Row = (typeof p.items)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Code', value: (r) => r.code, width: 9 },
    { header: 'Student', value: (r) => r.name, width: 24 },
    { header: 'Phone', value: (r) => r.phone, width: 14 },
    { header: 'Parent phone', value: (r) => r.guardianPhone, width: 14 },
    { header: 'Course', value: (r) => r.course, width: 22 },
    { header: 'Batch', value: (r) => r.batch, width: 20 },
    { header: 'Fee', value: (r) => r.fee, type: 'money' },
    { header: 'Paid', value: (r) => r.paid, type: 'money' },
    { header: 'Due', value: (r) => r.due, type: 'money' },
    { header: 'Last paid', value: (r) => r.lastPaid, type: 'date', width: 13 },
  ]
  return sendExcel(res, { fileName: 'fees-pending', title: 'Fees pending', filters: [...filters(q), `Total due ₹${p.total} (${p.count})`], columns, rows: [p.items], user })
}

export async function exportReceipts(res: Response, q: Q, user: string) {
  const where = receiptWhere(q)
  const fetch = (skip: number, take: number) =>
    prisma.feeReceipt.findMany({ where, orderBy: byDate(q.order), skip, take, include: { enrolment: { include: { student: true, batch: { include: { course: true } } } } } })
  type Row = Awaited<ReturnType<typeof fetch>>[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Receipt no', value: (r) => r.docNo, width: 20 },
    { header: 'Date', value: (r) => r.docDate, type: 'date', width: 13 },
    { header: 'Student', value: (r) => `${r.enrolment.student.code} ${r.enrolment.student.name}`, width: 26 },
    { header: 'Course', value: (r) => r.enrolment.batch.course.name, width: 22 },
    { header: 'Batch', value: (r) => r.enrolment.batch.name, width: 20 },
    { header: 'Paid by', value: (r) => r.mode, width: 10 },
    { header: 'Amount', value: (r) => r.amount, type: 'money' },
    { header: 'Reference', value: (r) => r.reference, width: 16 },
    { header: 'Status', value: (r) => (r.status === 'POSTED' ? 'Posted' : 'Cancelled'), width: 11 },
  ]
  return sendExcel(res, { fileName: 'fee-receipts', title: 'Fee receipts', filters: filters(q), columns, rows: inBatches(fetch), user })
}
