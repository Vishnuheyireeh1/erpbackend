import { byDate } from '../utils/order'
import { prisma } from '../config/prisma'
import type { Prisma } from '../generated/prisma/client'
import { dateRange } from '../utils/financialYear'
import type { DocumentListQuery } from '../validators/inventory.validator'

export function docWhere(q: Pick<DocumentListQuery, 'kind' | 'from' | 'to'>): Prisma.StockDocumentWhereInput {
  return { ...(q.kind ? { kind: q.kind } : {}), ...(dateRange(q.from, q.to) ? { docDate: dateRange(q.from, q.to) } : {}) }
}

// Data access for opening-stock / adjustment documents.

const itemSelect = {
  id: true,
  sku: true,
  barcode: true,
  size: { select: { name: true } },
  colour: { select: { name: true } },
  product: { select: { id: true, name: true, unit: { select: { code: true } } } },
} as const

export function findById(id: number) {
  return prisma.stockDocument.findUnique({
    where: { id },
    include: { lines: { orderBy: { id: 'asc' }, include: { variant: { select: itemSelect } } } },
  })
}

export async function list(q: DocumentListQuery) {
  const where = docWhere(q)
  const [items, total] = await Promise.all([
    prisma.stockDocument.findMany({
      where,
      orderBy: byDate(q.order),
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { _count: { select: { lines: true } } },
    }),
    prisma.stockDocument.count({ where }),
  ])
  return { items, total, page: q.page, pageSize: q.pageSize }
}
