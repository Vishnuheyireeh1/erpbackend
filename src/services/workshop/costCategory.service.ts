import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import type { CostCategoryInput } from '../../validators/workshop.validator'
import { audit } from '../audit.service'

// Job cost types (Cutting master, Hand work, Embroidery …) with how they are usually paid.

export async function list() {
  const items = await prisma.jobCostCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { _count: { select: { entries: true } } } })
  return items.map(({ _count, ...c }) => ({ ...c, entryCount: _count.entries }))
}

export async function create(input: CostCategoryInput, user: string) {
  return prisma.$transaction(async (tx) => {
    const c = await tx.jobCostCategory.create({ data: input })
    await audit(tx, { actor: user, action: 'cost_category.create', entity: 'job_cost_category', entityId: c.id, summary: `${c.name} added` })
    return c
  })
}

export async function update(id: number, input: CostCategoryInput, user: string) {
  const before = await prisma.jobCostCategory.findUnique({ where: { id } })
  if (!before) throw ApiError.notFound('Cost type not found')
  return prisma.$transaction(async (tx) => {
    const c = await tx.jobCostCategory.update({ where: { id }, data: input })
    await audit(tx, { actor: user, action: 'cost_category.update', entity: 'job_cost_category', entityId: id, summary: `${before.name} updated` })
    return c
  })
}

// Hard delete only while unused; otherwise make it Inactive.
export async function remove(id: number, user: string) {
  const c = await prisma.jobCostCategory.findUnique({ where: { id }, include: { _count: { select: { entries: true } } } })
  if (!c) throw ApiError.notFound('Cost type not found')
  if (c._count.entries) throw ApiError.conflict(`${c.name} is used on ${c._count.entries} job cost(s) — make it Inactive instead`)
  await prisma.$transaction(async (tx) => {
    await tx.jobCostCategory.delete({ where: { id } })
    await audit(tx, { actor: user, action: 'cost_category.delete', entity: 'job_cost_category', entityId: id, summary: `${c.name} deleted` })
  })
}
