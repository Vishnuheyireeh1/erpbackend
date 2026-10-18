import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import type { BatchInput, CourseInput } from '../../validators/training.validator'
import { audit } from '../audit.service'
import { dueByEnrolment } from './fee.service'

// Courses (what is taught + standard fee) and batches (a group of students with timing and a teacher).

export async function listCourses() {
  const items = await prisma.course.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { _count: { select: { batches: true } } } })
  return items.map(({ _count, ...c }) => ({ ...c, batchCount: _count.batches }))
}

export async function saveCourse(id: number | null, input: CourseInput, user: string) {
  const clash = await prisma.course.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } })
  if (clash) throw ApiError.conflict(`"${input.name}" already exists`)
  return prisma.$transaction(async (tx) => {
    const c = id ? await tx.course.update({ where: { id }, data: input }) : await tx.course.create({ data: input })
    await audit(tx, { actor: user, action: id ? 'course.update' : 'course.create', entity: 'course', entityId: c.id, summary: `Course ${c.name} — ₹${c.fee}, ${c.months} months` })
    return c
  })
}

// Delete only while no batch uses it (hard delete; otherwise make it inactive).
export async function removeCourse(id: number, user: string) {
  const c = await prisma.course.findUnique({ where: { id }, include: { _count: { select: { batches: true } } } })
  if (!c) throw ApiError.notFound('Course not found')
  if (c._count.batches) throw ApiError.conflict(`${c.name} has batches — make it inactive instead`)
  await prisma.$transaction(async (tx) => {
    await tx.course.delete({ where: { id } })
    await audit(tx, { actor: user, action: 'course.delete', entity: 'course', entityId: id, summary: `Course ${c.name} deleted` })
  })
}

export async function listBatches(q: { courseId?: number; status?: string }) {
  const items = await prisma.batch.findMany({
    where: { ...(q.courseId ? { courseId: q.courseId } : {}), ...(q.status === 'active' ? { isActive: true } : q.status === 'finished' ? { isActive: false } : {}) },
    orderBy: [{ isActive: 'desc' }, { startDate: 'desc' }],
    include: { course: { select: { id: true, name: true, fee: true } }, teacher: { select: { id: true, name: true } }, enrolments: { select: { id: true, status: true } } },
  })
  const due = await dueByEnrolment(items.flatMap((b) => b.enrolments.map((e) => e.id)))
  return items.map(({ enrolments, ...b }) => ({
    ...b,
    students: enrolments.filter((e) => e.status !== 'DROPPED').length,
    feesDue: Math.round(enrolments.reduce((s, e) => s + (e.status === 'DROPPED' ? 0 : due.get(e.id)?.due ?? 0), 0) * 100) / 100,
  }))
}

async function checkBatchRefs(input: BatchInput) {
  const course = await prisma.course.findUnique({ where: { id: input.courseId } })
  if (!course) throw ApiError.badRequest('Choose the course')
  if (input.teacherId && !(await prisma.staff.findFirst({ where: { id: input.teacherId, isActive: true } }))) throw ApiError.badRequest('Choose an active teacher (Staff)')
  return course
}

export async function saveBatch(id: number | null, input: BatchInput, user: string) {
  const course = await checkBatchRefs(input)
  if (id && !(await prisma.batch.findUnique({ where: { id } }))) throw ApiError.notFound('Batch not found')
  return prisma.$transaction(async (tx) => {
    const b = id ? await tx.batch.update({ where: { id }, data: input }) : await tx.batch.create({ data: input })
    await audit(tx, { actor: user, action: id ? 'batch.update' : 'batch.create', entity: 'batch', entityId: b.id, summary: `Batch ${b.name} (${course.name})${b.isActive ? '' : ' — finished'}` })
    return b
  })
}

export async function removeBatch(id: number, user: string) {
  const b = await prisma.batch.findUnique({ where: { id }, include: { _count: { select: { enrolments: true } } } })
  if (!b) throw ApiError.notFound('Batch not found')
  if (b._count.enrolments) throw ApiError.conflict(`${b.name} has students — mark it finished instead`)
  await prisma.$transaction(async (tx) => {
    await tx.batch.delete({ where: { id } })
    await audit(tx, { actor: user, action: 'batch.delete', entity: 'batch', entityId: id, summary: `Batch ${b.name} deleted` })
  })
}
