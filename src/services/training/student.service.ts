import { prisma } from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { nextValue } from '../../models/counter.model'
import { ApiError } from '../../utils/ApiError'
import { toDocDate } from '../../utils/financialYear'
import type { EnrolInput, EnrolmentUpdate, NewStudentInput, StudentInput, TrainingListQuery } from '../../validators/training.validator'
import { audit } from '../audit.service'
import { createReceiptTx, dueByEnrolment } from './fee.service'

// Students (ST0001), their enrolments in batches, and the "fees pending" list.

type Tx = Prisma.TransactionClient
const r2 = (n: number) => Math.round(n * 100) / 100
const enrolInclude = { batch: { select: { id: true, name: true, timing: true, isActive: true, course: { select: { id: true, name: true, months: true } } } } } as const

async function enrolTx(tx: Tx, studentId: number, input: EnrolInput, user: string) {
  const batch = await tx.batch.findUnique({ where: { id: input.batchId }, include: { course: true } })
  if (!batch) throw ApiError.badRequest('Choose the batch')
  if (await tx.enrolment.findUnique({ where: { studentId_batchId: { studentId, batchId: batch.id } } })) throw ApiError.conflict(`Already in ${batch.name}`)
  const { date } = toDocDate(input.joinedOn)
  const e = await tx.enrolment.create({ data: { studentId, batchId: batch.id, joinedOn: date, fee: input.fee, notes: input.notes, createdBy: user } })
  await audit(tx, { actor: user, action: 'enrolment.create', entity: 'enrolment', entityId: e.id, summary: `Student #${studentId} joined ${batch.course.name} · ${batch.name} — fee ₹${input.fee}` })
  if (input.firstPayment) await createReceiptTx(tx, { enrolmentId: e.id, amount: input.firstPayment.amount, mode: input.firstPayment.mode, reference: input.firstPayment.reference, notes: 'Paid at joining' }, toDocDate(undefined).date, user)
  return e
}

export async function createStudent(input: NewStudentInput, user: string) {
  const { enrol, ...data } = input
  const id = await prisma.$transaction(async (tx) => {
    const code = `ST${String(await nextValue(tx, 'student')).padStart(4, '0')}`
    const s = await tx.student.create({ data: { ...data, code } })
    await audit(tx, { actor: user, action: 'student.create', entity: 'student', entityId: s.id, summary: `${code} ${s.name} added` })
    if (enrol) await enrolTx(tx, s.id, enrol, user)
    return s.id
  })
  return getStudent(id)
}

export async function updateStudent(id: number, input: StudentInput, user: string) {
  const s = await prisma.student.findUnique({ where: { id } })
  if (!s) throw ApiError.notFound('Student not found')
  await prisma.$transaction(async (tx) => {
    await tx.student.update({ where: { id }, data: input })
    await audit(tx, { actor: user, action: 'student.update', entity: 'student', entityId: id, summary: `${s.code} ${input.name} updated` })
  })
  return getStudent(id)
}

export async function removeStudent(id: number, user: string) {
  const s = await prisma.student.findUnique({ where: { id }, include: { _count: { select: { enrolments: true } } } })
  if (!s) throw ApiError.notFound('Student not found')
  if (s._count.enrolments) throw ApiError.conflict(`${s.name} is enrolled in a course — mark the course as Left instead`)
  await prisma.$transaction(async (tx) => {
    await tx.student.delete({ where: { id } })
    await audit(tx, { actor: user, action: 'student.delete', entity: 'student', entityId: id, summary: `${s.code} ${s.name} deleted` })
  })
}

export async function enrol(studentId: number, input: EnrolInput, user: string) {
  if (!(await prisma.student.findUnique({ where: { id: studentId } }))) throw ApiError.notFound('Student not found')
  await prisma.$transaction((tx) => enrolTx(tx, studentId, input, user))
  return getStudent(studentId)
}

export async function updateEnrolment(id: number, input: EnrolmentUpdate, user: string) {
  const e = await prisma.enrolment.findUnique({ where: { id }, include: { batch: { include: { course: true } } } })
  if (!e) throw ApiError.notFound('Enrolment not found')
  const paid = (await dueByEnrolment([id])).get(id)!.paid
  if (input.fee < paid) throw ApiError.badRequest(`₹${paid} is already received — the fee can't be less than that`)
  await prisma.$transaction(async (tx) => {
    await tx.enrolment.update({ where: { id }, data: input })
    const change = Number(e.fee) !== input.fee ? ` fee ₹${e.fee} → ₹${input.fee}` : ''
    await audit(tx, { actor: user, action: 'enrolment.update', entity: 'enrolment', entityId: id, summary: `${e.batch.course.name} · student #${e.studentId}: ${input.status.toLowerCase()}${change}` })
  })
  return getStudent(e.studentId)
}

export async function getStudent(id: number) {
  const s = await prisma.student.findUnique({
    where: { id },
    include: { enrolments: { orderBy: { joinedOn: 'desc' }, include: { ...enrolInclude, receipts: { orderBy: [{ docDate: 'desc' }, { id: 'desc' }] } } } },
  })
  if (!s) throw ApiError.notFound('Student not found')
  const due = await dueByEnrolment(s.enrolments.map((e) => e.id))
  return { ...s, enrolments: s.enrolments.map((e) => ({ ...e, ...due.get(e.id)! })) }
}

export function studentWhere(q: Omit<TrainingListQuery, 'page' | 'pageSize'>) {
  const where: Prisma.StudentWhereInput = {}
  const enrol: Prisma.EnrolmentWhereInput = {}
  if (q.status === 'STUDYING' || q.status === 'COMPLETED' || q.status === 'DROPPED') enrol.status = q.status
  if (q.batchId) enrol.batchId = q.batchId
  if (q.courseId) enrol.batch = { courseId: q.courseId }
  if (Object.keys(enrol).length) where.enrolments = { some: enrol }
  if (q.search) where.OR = [{ name: { contains: q.search, mode: 'insensitive' } }, { code: { contains: q.search, mode: 'insensitive' } }, { phone: { contains: q.search } }, { guardianPhone: { contains: q.search } }]
  return where
}

export async function listStudents(q: TrainingListQuery) {
  const where = studentWhere(q)
  const [items, total] = await Promise.all([
    prisma.student.findMany({ where, orderBy: { name: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { enrolments: { orderBy: { joinedOn: 'desc' }, include: enrolInclude } } }),
    prisma.student.count({ where }),
  ])
  const due = await dueByEnrolment(items.flatMap((s) => s.enrolments.map((e) => e.id)))
  return {
    items: items.map((s) => {
      const en = s.enrolments.map((e) => ({ ...e, ...due.get(e.id)! }))
      return { ...s, enrolments: en, fee: r2(en.reduce((t, e) => t + (e.status === 'DROPPED' ? e.paid : e.fee), 0)), paid: r2(en.reduce((t, e) => t + e.paid, 0)), due: r2(en.reduce((t, e) => t + e.due, 0)) }
    }),
    total, page: q.page, pageSize: q.pageSize,
  }
}

// Enrolments that still owe fees (not left), biggest first.
export async function pendingFees(q: Omit<TrainingListQuery, 'page' | 'pageSize'>) {
  const conds = [Prisma.sql`e.status <> 'DROPPED'`, Prisma.sql`e.fee - COALESCE(p.paid, 0) > 0.004`]
  if (q.batchId) conds.push(Prisma.sql`e.batch_id = ${q.batchId}`)
  if (q.search) conds.push(Prisma.sql`(s.name ILIKE ${`%${q.search}%`} OR s.code ILIKE ${`%${q.search}%`} OR s.phone LIKE ${`%${q.search}%`})`)
  const rows = await prisma.$queryRaw<{ id: number; student_id: number; code: string; name: string; phone: string | null; guardian_phone: string | null; course: string; batch: string; joined_on: Date; fee: Prisma.Decimal; paid: Prisma.Decimal | null; last_paid: Date | null }[]>`
    SELECT e.id, s.id AS student_id, s.code, s.name, s.phone, s.guardian_phone, c.name AS course, b.name AS batch, e.joined_on, e.fee, p.paid, p.last_paid
      FROM enrolments e JOIN students s ON s.id = e.student_id JOIN batches b ON b.id = e.batch_id JOIN courses c ON c.id = b.course_id
      LEFT JOIN (SELECT enrolment_id, SUM(amount) AS paid, MAX(doc_date) AS last_paid FROM fee_receipts WHERE status = 'POSTED' GROUP BY 1) p ON p.enrolment_id = e.id
     WHERE ${Prisma.join(conds, ' AND ')} ORDER BY e.fee - COALESCE(p.paid, 0) DESC, s.name LIMIT 2000`
  const items = rows.map((r) => ({ enrolmentId: r.id, studentId: r.student_id, code: r.code, name: r.name, phone: r.phone, guardianPhone: r.guardian_phone, course: r.course, batch: r.batch, joinedOn: r.joined_on, fee: Number(r.fee), paid: Number(r.paid ?? 0), due: r2(Number(r.fee) - Number(r.paid ?? 0)), lastPaid: r.last_paid }))
  return { items, total: r2(items.reduce((s, i) => s + i.due, 0)), count: items.length }
}
