import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import type { GarmentInput } from '../../validators/workshop.validator'
import { audit } from '../audit.service'

// Garment types (Blouse, Churidar …) with their measurement fields and default prices.

export async function list(includeInactive = true) {
  const items = await prisma.garmentType.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { measurements: true } }, costDefaults: { select: { categoryId: true, rate: true } } },
  })
  return items.map(({ _count, ...g }) => ({ ...g, fields: g.fields as string[], measurementCount: _count.measurements }))
}

export async function create(input: GarmentInput, user: string) {
  const { costDefaults, ...data } = input
  return prisma.$transaction(async (tx) => {
    const g = await tx.garmentType.create({ data })
    await setCostDefaultsTx(tx, g.id, costDefaults)
    await audit(tx, { actor: user, action: 'garment.create', entity: 'garment_type', entityId: g.id, summary: `${g.name} added (${input.fields.length} measurements)` })
    return g
  })
}

// Renaming / removing a field never touches saved measurements (they keep their own labels).
export async function update(id: number, input: GarmentInput, user: string) {
  const before = await prisma.garmentType.findUnique({ where: { id } })
  if (!before) throw ApiError.notFound('Garment type not found')
  const { costDefaults, ...data } = input
  return prisma.$transaction(async (tx) => {
    const g = await tx.garmentType.update({ where: { id }, data })
    await setCostDefaultsTx(tx, id, costDefaults)
    await audit(tx, { actor: user, action: 'garment.update', entity: 'garment_type', entityId: id, summary: `${before.name} updated` })
    return g
  })
}

// Usual costs per piece are replaced as a whole set (0 / empty = none).
async function setCostDefaultsTx(tx: Prisma.TransactionClient, garmentTypeId: number, rows: GarmentInput['costDefaults']) {
  await tx.garmentCostDefault.deleteMany({ where: { garmentTypeId } })
  const keep = rows.filter((r) => r.rate > 0)
  if (new Set(keep.map((r) => r.categoryId)).size !== keep.length) throw ApiError.badRequest('A cost type is listed twice')
  if (keep.length) await tx.garmentCostDefault.createMany({ data: keep.map((r) => ({ ...r, garmentTypeId })) })
}

// A charge typed on a bill that the garment doesn't list yet → added to its options (shown next time).
export async function addCharge(id: number, name: string, user: string) {
  const g = await prisma.garmentType.findUnique({ where: { id } })
  if (!g) throw ApiError.notFound('Garment type not found')
  const list = (g.charges as string[]) ?? []
  if (list.some((c) => c.toLowerCase() === name.toLowerCase())) return list
  if (list.length >= 20) return list // the garment form allows at most 20
  const charges = [...list, name]
  await prisma.$transaction(async (tx) => {
    await tx.garmentType.update({ where: { id }, data: { charges } })
    await audit(tx, { actor: user, action: 'garment.charge', entity: 'garment_type', entityId: id, summary: `${g.name}: charge "${name}" added from a bill` })
  })
  return charges
}

// Hard delete only when nothing uses it; otherwise make it Inactive.
export async function remove(id: number, user: string) {
  const g = await prisma.garmentType.findUnique({ where: { id }, include: { _count: { select: { measurements: true, jobItems: true, brandItems: true } } } })
  if (!g) throw ApiError.notFound('Garment type not found')
  if (g._count.jobItems > 0) throw ApiError.conflict(`${g.name} is used on ${g._count.jobItems} job(s) — make it Inactive instead`)
  if (g._count.brandItems > 0) throw ApiError.conflict(`${g.name} is used on ${g._count.brandItems} brand order piece(s) — make it Inactive instead`)
  if (g._count.measurements > 0) throw ApiError.conflict(`${g.name} has ${g._count.measurements} saved measurement(s) — make it Inactive instead`)
  await prisma.$transaction(async (tx) => {
    await tx.garmentType.delete({ where: { id } })
    await audit(tx, { actor: user, action: 'garment.delete', entity: 'garment_type', entityId: id, summary: `${g.name} deleted` })
  })
}
