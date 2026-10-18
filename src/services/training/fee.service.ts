import { byDate } from '../../utils/order'
import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import { dateRange, nextDocNo, toDocDate } from '../../utils/financialYear'
import type { FeeReceiptInput, TrainingListQuery } from '../../validators/training.validator'
import { audit } from '../audit.service'

// Fee receipts (FEE/…) and what each enrolment still owes:  due = fee − received (cancelled receipts don't count).
// Dropped students owe nothing more. Overpaying is blocked (no advances here — keeps it simple for the counter).

const r2 = (n: number) => Math.round(n * 100) / 100
type Tx = Prisma.TransactionClient

export async function dueByEnrolment(ids: number[], db: Tx | typeof prisma = prisma) {
  const map = new Map<number, { fee: number; paid: number; due: number }>()
  if (!ids.length) return map
  const [enrolments, paid] = await Promise.all([
    db.enrolment.findMany({ where: { id: { in: ids } }, select: { id: true, fee: true, status: true } }),
    db.feeReceipt.groupBy({ by: ['enrolmentId'], where: { enrolmentId: { in: ids }, status: 'POSTED' }, _sum: { amount: true } }),
  ])
  for (const e of enrolments) {
    const p = Number(paid.find((x) => x.enrolmentId === e.id)?._sum.amount ?? 0)
    map.set(e.id, { fee: Number(e.fee), paid: r2(p), due: e.status === 'DROPPED' ? 0 : r2(Math.max(0, Number(e.fee) - p)) })
  }
  return map
}

// Inside the caller's transaction (also used when a student pays at joining).
export async function createReceiptTx(tx: Tx, input: FeeReceiptInput, date: Date, user: string) {
  // Lock the enrolment so two receipts at once can't both pass the "not more than due" check.
  const [row] = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM enrolments WHERE id = ${input.enrolmentId} FOR UPDATE`
  if (!row) throw ApiError.badRequest('Enrolment not found')
  const e = await tx.enrolment.findUniqueOrThrow({ where: { id: input.enrolmentId }, include: { student: true, batch: { include: { course: true } } } })
  if (e.status === 'DROPPED') throw ApiError.badRequest(`${e.student.name} has left this course — mark them as studying first`)
  const due = (await dueByEnrolment([e.id], tx)).get(e.id)!.due
  if (input.amount > due + 0.004) throw ApiError.badRequest(due > 0 ? `Only ₹${due} is due for ${e.batch.course.name}` : `${e.batch.course.name} is fully paid`)
  const docNo = await nextDocNo(tx, 'FEE', date)
  const r = await tx.feeReceipt.create({ data: { ...input, docNo, docDate: date, createdBy: user } })
  await audit(tx, { actor: user, action: 'fee.receive', entity: 'fee_receipt', entityId: r.id, summary: `${docNo} ${e.student.name} — ${e.batch.course.name} ₹${input.amount} (${input.mode})` })
  return r
}

export async function createReceipt(input: FeeReceiptInput, user: string) {
  const { date, isFuture } = toDocDate(input.docDate)
  if (isFuture) throw ApiError.badRequest("Date can't be in the future")
  const r = await prisma.$transaction((tx) => createReceiptTx(tx, input, date, user))
  return getReceipt(r.id)
}

export async function cancelReceipt(id: number, reason: string, user: string) {
  await prisma.$transaction(async (tx) => {
    const r = await tx.feeReceipt.findUnique({ where: { id } })
    if (!r) throw ApiError.notFound('Receipt not found')
    const done = await tx.feeReceipt.updateMany({ where: { id, status: 'POSTED' }, data: { status: 'CANCELLED', cancelledBy: user, cancelledAt: new Date(), cancelReason: reason } })
    if (done.count === 0) throw ApiError.conflict(`${r.docNo} is already cancelled`)
    await audit(tx, { actor: user, action: 'fee.cancel', entity: 'fee_receipt', entityId: id, summary: `${r.docNo} cancelled — ${reason}` })
  })
  return getReceipt(id)
}

const receiptInclude = { enrolment: { select: { id: true, fee: true, student: { select: { id: true, code: true, name: true, phone: true } }, batch: { select: { id: true, name: true, course: { select: { name: true } } } } } } } as const

export async function getReceipt(id: number) {
  const r = await prisma.feeReceipt.findUnique({ where: { id }, include: receiptInclude })
  if (!r) throw ApiError.notFound('Receipt not found')
  return { ...r, balance: (await dueByEnrolment([r.enrolmentId])).get(r.enrolmentId)! }
}

export function receiptWhere(q: Omit<TrainingListQuery, 'page' | 'pageSize'>) {
  const where: Prisma.FeeReceiptWhereInput = {}
  if (q.status === 'POSTED' || q.status === 'CANCELLED') where.status = q.status
  if (q.batchId) where.enrolment = { batchId: q.batchId }
  const range = dateRange(q.from, q.to)
  if (range) where.docDate = range
  if (q.search) where.OR = [{ docNo: { contains: q.search, mode: 'insensitive' } }, { enrolment: { student: { name: { contains: q.search, mode: 'insensitive' } } } }, { enrolment: { student: { phone: { contains: q.search } } } }]
  return where
}

export async function listReceipts(q: TrainingListQuery) {
  const where = receiptWhere(q)
  const [items, total, sum] = await Promise.all([
    prisma.feeReceipt.findMany({ where, include: receiptInclude, orderBy: byDate(q.order), skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.feeReceipt.count({ where }),
    prisma.feeReceipt.aggregate({ where: { ...where, status: 'POSTED' }, _sum: { amount: true } }),
  ])
  return { items, total, page: q.page, pageSize: q.pageSize, totalReceived: Number(sum._sum.amount ?? 0) }
}
