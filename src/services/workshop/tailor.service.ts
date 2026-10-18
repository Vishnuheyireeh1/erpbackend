import type { Prisma } from '../../generated/prisma/client'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import type { TailorListQuery } from '../../validators/workshop.validator'
import { balances, earnedRows } from './tailor.statement'

// Workers (tailors, embroidery, cutting … — the job-work profile of a staff member; created and edited in Staff & salary,
// see services/staff/staff.worker.ts). Balance = opening + pay earned − paid (see tailor.statement.ts).

function listWhere(q: Pick<TailorListQuery, 'search' | 'status' | 'work'>) {
  const where: Prisma.TailorWhereInput = {}
  if (q.status !== 'all') where.isActive = q.status === 'active'
  if (q.work === 'STITCHING') where.stitches = true
  else if (q.work) where.works = { some: { categoryId: Number(q.work) } }
  if (q.search) {
    where.OR = [
      { name: { contains: q.search, mode: 'insensitive' } },
      { code: { contains: q.search, mode: 'insensitive' } },
      { phone: { contains: q.search } },
      { speciality: { contains: q.search, mode: 'insensitive' } },
    ]
  }
  return where
}

const r2 = (n: number) => Math.round(n * 100) / 100

export async function list(q: TailorListQuery) {
  const where = listWhere(q)
  const [items, total] = await Promise.all([
    prisma.tailor.findMany({
      where, orderBy: { name: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      include: { staff: { select: { id: true, code: true, role: true } }, works: { select: { category: { select: { name: true } } } } },
    }),
    prisma.tailor.count({ where }),
  ])
  const ids = items.map((t) => t.id)
  const [b, done] = await Promise.all([balances(ids), earnedRows({ tailorIds: ids, from: q.from, to: q.to, kind: ['JOB', 'BRD'] })])
  // Work done between the dates: jobs, pieces and pay earned (salaried people: ₹0, work still counted).
  const period = (id: number) => {
    const mine = done.filter((e) => e.tailor_id === id)
    return { jobs: mine.length, pieces: mine.reduce((s, e) => s + e.pieces, 0), earned: r2(mine.reduce((s, e) => s + Number(e.labour), 0)) }
  }
  return {
    items: items.map((t) => ({
      ...t, ...b.get(t.id)!, balance: r2(Number(t.openingBalance) + b.get(t.id)!.earned - b.get(t.id)!.paid),
      does: [...(t.stitches ? ['Stitching'] : []), ...t.works.map((w) => w.category.name)], period: period(t.id),
    })),
    total, page: q.page, pageSize: q.pageSize,
  }
}

export async function getById(id: number) {
  const t = await prisma.tailor.findUnique({
    where: { id },
    include: { staff: { select: { id: true, code: true, role: true } }, rates: { include: { garmentType: { select: { id: true, name: true } } }, orderBy: { garmentType: { sortOrder: 'asc' } } } },
  })
  if (!t) throw ApiError.notFound('Tailor not found')
  const b = (await balances([id])).get(id)!
  return { ...t, ...b, balance: r2(Number(t.openingBalance) + b.earned - b.paid) }
}

// For dropdowns on jobs: active workers, the work they do and their own rates.
export function options() {
  return prisma.tailor.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: {
      id: true, code: true, name: true, payType: true, stitches: true, speciality: true, staffId: true,
      rates: { select: { garmentTypeId: true, rate: true } }, works: { select: { categoryId: true, rate: true } },
    },
  })
}
