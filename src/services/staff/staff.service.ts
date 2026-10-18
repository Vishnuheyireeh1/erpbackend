import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { nextValue } from '../../models/counter.model'
import { ApiError } from '../../utils/ApiError'
import { todayIST } from '../../utils/financialYear'
import type { StaffInput, StaffListQuery } from '../../validators/staff.validator'
import { audit } from '../audit.service'
import { checkWork, syncWorkerTx, workersOf } from './staff.worker'

// Staff details (E001 …). Salary paid is recorded separately (salary.service.ts).

export function staffWhere(q: Pick<StaffListQuery, 'search' | 'status'>) {
  const where: Prisma.StaffWhereInput = {}
  if (q.status !== 'all') where.isActive = q.status === 'active'
  if (q.search) {
    where.OR = [
      { name: { contains: q.search, mode: 'insensitive' } },
      { code: { contains: q.search, mode: 'insensitive' } },
      { phone: { contains: q.search } },
      { role: { contains: q.search, mode: 'insensitive' } },
    ]
  }
  return where
}

const r2 = (n: number) => Math.round(n * 100) / 100

// Paid this month + paid in total, per staff member (posted payments only).
async function paidTotals(ids: number[]) {
  const month = new Date(`${todayIST().slice(0, 8)}01T00:00:00Z`)
  const [all, thisMonth] = await Promise.all([
    prisma.salaryPayment.groupBy({ by: ['staffId'], where: { staffId: { in: ids }, status: 'POSTED' }, _sum: { amount: true } }),
    prisma.salaryPayment.groupBy({ by: ['staffId'], where: { staffId: { in: ids }, status: 'POSTED', month }, _sum: { amount: true } }),
  ])
  const get = (rows: typeof all, id: number) => r2(Number(rows.find((r) => r.staffId === id)?._sum.amount ?? 0))
  return (id: number) => ({ paidThisMonth: get(thisMonth, id), paidTotal: get(all, id) })
}

export async function list(q: StaffListQuery) {
  const where = staffWhere(q)
  const [items, total] = await Promise.all([
    prisma.staff.findMany({ where, orderBy: { name: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.staff.count({ where }),
  ])
  const [paid, workers] = await Promise.all([paidTotals(items.map((s) => s.id)), workersOf(items.map((s) => s.id))])
  return { items: items.map((s) => ({ ...s, ...paid(s.id), worker: workers.get(s.id) ?? null })), total, page: q.page, pageSize: q.pageSize }
}

export async function getById(id: number) {
  const s = await prisma.staff.findUnique({ where: { id } })
  if (!s) throw ApiError.notFound('Staff member not found')
  const [paid, workers] = await Promise.all([paidTotals([id]), workersOf([id])])
  return { ...s, ...paid(id), worker: workers.get(id) ?? null }
}

export async function create(input: StaffInput, user: string) {
  const { work, ...data } = input
  await checkWork(work)
  const id = await prisma.$transaction(async (tx) => {
    const code = `E${String(await nextValue(tx, 'staff')).padStart(3, '0')}`
    const s = await tx.staff.create({ data: { ...data, code } })
    const w = await syncWorkerTx(tx, s, work)
    await audit(tx, { actor: user, action: 'staff.create', entity: 'staff', entityId: s.id, summary: `${code} ${s.name} (${s.role}) added${w ? ` — ${w}` : ''}` })
    return s.id
  })
  return getById(id)
}

export async function update(id: number, input: StaffInput, user: string) {
  const before = await prisma.staff.findUnique({ where: { id } })
  if (!before) throw ApiError.notFound('Staff member not found')
  const { work, ...data } = input
  await checkWork(work)
  await prisma.$transaction(async (tx) => {
    const s = await tx.staff.update({ where: { id }, data })
    const w = await syncWorkerTx(tx, s, work)
    const salary = Number(before.salary) !== input.salary ? ` — salary ₹${before.salary} → ₹${input.salary}` : ''
    await audit(tx, { actor: user, action: 'staff.update', entity: 'staff', entityId: id, summary: `${before.code} ${input.name} updated${salary}${w ? ` — ${w}` : ''}` })
  })
  return getById(id)
}

// Hard delete only while nothing was paid to them; otherwise make them Inactive.
export async function remove(id: number, user: string) {
  const s = await prisma.staff.findUnique({ where: { id }, include: { _count: { select: { payments: true, batches: true } } } })
  if (!s) throw ApiError.notFound('Staff member not found')
  if (s._count.payments || s._count.batches) throw ApiError.conflict(`${s.name} has salary payments or teaches a batch — make them Inactive instead`)
  const w = await prisma.tailor.findUnique({ where: { staffId: id }, include: { _count: { select: { jobItems: true, payments: true, productionCosts: true, workEntries: true } } } })
  if (w && (w._count.jobItems || w._count.payments || w._count.productionCosts || w._count.workEntries)) throw ApiError.conflict(`${s.name} has job work or payments — make them Inactive instead`)
  await prisma.$transaction(async (tx) => {
    if (w) await tx.tailor.delete({ where: { id: w.id } })
    await tx.staff.delete({ where: { id } })
    await audit(tx, { actor: user, action: 'staff.delete', entity: 'staff', entityId: id, summary: `${s.code} ${s.name} deleted` })
  })
}

export const options = () =>
  prisma.staff.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, role: true, salary: true } })
