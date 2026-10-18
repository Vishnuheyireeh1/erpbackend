import { prisma } from '../config/prisma'
import type { Prisma } from '../generated/prisma/client'
import type { StockListQuery } from '../validators/inventory.validator'

// Read-only stock views. Stock is per VARIANT; services (no stock) are excluded.

const minStock = () => prisma.productVariant.fields.minStock

export function statusWhere(status: StockListQuery['status']): Prisma.ProductVariantWhereInput {
  if (status === 'available') return { stockQty: { gt: 0 } }
  if (status === 'out') return { stockQty: { lte: 0 } }
  if (status === 'low') return { AND: [{ stockQty: { gt: 0 } }, { stockQty: { lte: minStock() } }] }
  if (status === 'in') return { AND: [{ stockQty: { gt: 0 } }, { stockQty: { gt: minStock() } }] }
  return {}
}

export function baseWhere(q: Pick<StockListQuery, 'search' | 'categoryId' | 'ids' | 'productId'>): Prisma.ProductVariantWhereInput {
  const product: Prisma.ProductWhereInput = { type: { not: 'SERVICE' } }
  if (q.categoryId) product.OR = [{ categoryId: q.categoryId }, { category: { parentId: q.categoryId } }]
  if (q.productId) product.id = q.productId
  const where: Prisma.ProductVariantWhereInput = { product }
  if (q.ids) where.id = { in: q.ids }
  if (q.search) {
    // Full barcode (scanner) · start of an SKU / product code ("P000003-M") ·
    // or every typed word found in name / code / size / colour, any order ("anarkali red", "kurti xl").
    const s = q.search.trim()
    const words = s.split(/\s+/).filter(Boolean).slice(0, 5)
    where.OR = [
      { barcode: s },
      { sku: { startsWith: s.toUpperCase() } },
      {
        AND: words.map((w) => ({
          OR: [
            { product: { name: { contains: w, mode: 'insensitive' as const } } },
            { sku: { contains: w, mode: 'insensitive' as const } },
            { size: { name: { equals: w, mode: 'insensitive' as const } } },
            { colour: { name: { contains: w, mode: 'insensitive' as const } } },
          ],
        })),
      },
    ]
  }
  return where
}

const rowSelect = {
  id: true,
  sku: true,
  barcode: true,
  minStock: true,
  stockQty: true,
  avgCost: true,
  stockValue: true,
  sellingPrice: true,
  purchasePrice: true,
  mrp: true,
  isActive: true,
  size: { select: { name: true, sortOrder: true } },
  colour: { select: { name: true, hexCode: true } },
  product: {
    select: {
      id: true,
      code: true,
      name: true,
      imagePath: true,
      unit: { select: { code: true, allowDecimal: true } },
      taxRate: { select: { rate: true } },
      hsnCode: true,
      category: { select: { name: true, parent: { select: { name: true } } } },
    },
  },
} satisfies Prisma.ProductVariantSelect

export async function list(q: StockListQuery) {
  const where = { AND: [baseWhere(q), statusWhere(q.status)] }
  const [items, total] = await Promise.all([
    prisma.productVariant.findMany({
      where,
      select: rowSelect,
      orderBy: [{ product: { name: 'asc' } }, { id: 'asc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.productVariant.count({ where }),
  ])
  return { items, total, page: q.page, pageSize: q.pageSize }
}

// Totals for the cards at the top of the stock page.
export async function summary() {
  const base = baseWhere({})
  const count = (status: StockListQuery['status']) =>
    prisma.productVariant.count({ where: { AND: [base, statusWhere(status)] } })
  const [value, inStock, low, out] = await Promise.all([
    prisma.productVariant.aggregate({ where: base, _sum: { stockValue: true } }),
    count('in'),
    count('low'),
    count('out'),
  ])
  return { stockValue: Number(value._sum.stockValue ?? 0), inStock, low, out }
}

export function findVariant(id: number) {
  return prisma.productVariant.findUnique({ where: { id }, select: rowSelect })
}

// Ledger for one item, newest first (or oldest first).
export async function ledger(variantId: number, page: number, pageSize: number, dir: 'asc' | 'desc' = 'desc') {
  const where = { variantId }
  const [items, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      orderBy: { id: dir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.stockMovement.count({ where }),
  ])
  // BigInt id → string so JSON can carry it.
  return { items: items.map((m) => ({ ...m, id: m.id.toString() })), total, page, pageSize }
}
