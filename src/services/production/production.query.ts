import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import { dateRange } from '../../utils/financialYear'
import type { ProductionListQuery } from '../../validators/production.validator'

// Production entries: list (with what was made), one entry with every line.

const variantSelect = {
  id: true, sku: true, barcode: true, sellingPrice: true,
  size: { select: { name: true } }, colour: { select: { name: true } },
  product: { select: { id: true, name: true, unit: { select: { code: true } } } },
} as const

export function productionWhere(q: Omit<ProductionListQuery, 'page' | 'pageSize'>) {
  const where: Prisma.ProductionOrderWhereInput = {}
  if (q.status !== 'all') where.status = q.status
  if (q.productId) where.outputs = { some: { variant: { productId: q.productId } } }
  const range = dateRange(q.from, q.to)
  if (range) where.docDate = range
  if (q.search) {
    where.OR = [
      { docNo: { contains: q.search, mode: 'insensitive' } },
      { title: { contains: q.search, mode: 'insensitive' } },
      { outputs: { some: { variant: { OR: [{ sku: { contains: q.search, mode: 'insensitive' } }, { product: { name: { contains: q.search, mode: 'insensitive' } } }] } } } },
    ]
  }
  return where
}

export async function listProduction(q: ProductionListQuery) {
  const where = productionWhere(q)
  const [items, total, sums] = await Promise.all([
    prisma.productionOrder.findMany({
      where,
      orderBy: [{ docDate: 'desc' }, { id: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { outputs: { orderBy: { sortOrder: 'asc' }, select: { qty: true, variant: { select: { product: { select: { name: true } } } } } } },
    }),
    prisma.productionOrder.count({ where }),
    prisma.productionOrder.aggregate({ where: { ...where, status: 'POSTED' }, _sum: { pieces: true, stockCost: true } }),
  ])
  return {
    items: items.map(({ outputs, ...o }) => ({ ...o, made: [...new Set(outputs.map((x) => x.variant.product.name))].join(', ') })),
    total, page: q.page, pageSize: q.pageSize,
    totals: { pieces: Number(sums._sum.pieces ?? 0), stockCost: Number(sums._sum.stockCost ?? 0) },
  }
}

export async function getProduction(id: number) {
  const o = await prisma.productionOrder.findUnique({
    where: { id },
    include: {
      outputs: { orderBy: { sortOrder: 'asc' }, include: { variant: { select: variantSelect } } },
      materials: { orderBy: { sortOrder: 'asc' }, include: { variant: { select: variantSelect } } },
      costs: { orderBy: { sortOrder: 'asc' }, include: { tailor: { select: { id: true, code: true, name: true } } } },
    },
  })
  if (!o) throw ApiError.notFound('Production entry not found')
  return o
}
