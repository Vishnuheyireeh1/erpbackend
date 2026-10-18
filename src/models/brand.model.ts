import { prisma } from '../config/prisma'
import type { Prisma } from '../generated/prisma/client'
import type { BrandListQuery } from '../validators/brand.validator'

// Data access for partner brands (the brands Sairandhri stitches for).

export function listWhere(q: Pick<BrandListQuery, 'search' | 'status'>): Prisma.PartnerBrandWhereInput {
  const where: Prisma.PartnerBrandWhereInput = {}
  if (q.status !== 'all') where.isActive = q.status === 'active'
  if (q.search) {
    const s = q.search
    where.OR = [
      { name: { contains: s, mode: 'insensitive' } },
      { contactPerson: { contains: s, mode: 'insensitive' } },
      { code: s.toUpperCase() },
      { gstin: s.toUpperCase() },
      { phone: { contains: s } },
    ]
  }
  return where
}

export const findMany = (where: Prisma.PartnerBrandWhereInput) => prisma.partnerBrand.findMany({ where, orderBy: { name: 'asc' } })
export const findById = (id: number) => prisma.partnerBrand.findUnique({ where: { id } })

// Billed (delivery bills) / paid (money received) per brand — cancelled documents never count.
export async function totals(ids: number[]) {
  const map = new Map<number, { billed: number; paid: number }>()
  for (const id of ids) map.set(id, { billed: 0, paid: 0 })
  if (!ids.length) return map
  const where = { brandId: { in: ids }, status: 'POSTED' as const }
  const [bills, payments] = await Promise.all([
    prisma.brandBill.groupBy({ by: ['brandId'], where, _sum: { grandTotal: true } }),
    prisma.brandPayment.groupBy({ by: ['brandId'], where, _sum: { amount: true } }),
  ])
  bills.forEach((b) => (map.get(b.brandId)!.billed = Number(b._sum.grandTotal ?? 0)))
  payments.forEach((p) => (map.get(p.brandId)!.paid = Number(p._sum.amount ?? 0)))
  return map
}

// Orders / bills / payments that use this brand — blocks delete.
export async function documentCount(id: number) {
  const [orders, payments] = await Promise.all([prisma.brandOrder.count({ where: { brandId: id } }), prisma.brandPayment.count({ where: { brandId: id } })])
  return orders + payments
}
