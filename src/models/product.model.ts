import { prisma } from '../config/prisma'
import type { Prisma } from '../generated/prisma/client'
import type { ProductListQuery } from '../validators/product.validator'

// Database access for products (no business rules here).

const variantInclude = {
  size: { select: { id: true, name: true, sortOrder: true } },
  colour: { select: { id: true, name: true, hexCode: true } },
} satisfies Prisma.ProductVariantInclude

export const productDetailInclude = {
  category: { select: { id: true, name: true, parentId: true, parent: { select: { name: true } } } },
  brand: { select: { id: true, name: true } },
  productType: { select: { id: true, name: true, kind: true } },
  unit: { select: { id: true, name: true, code: true, allowDecimal: true } },
  taxRate: { select: { id: true, name: true, rate: true } },
  variants: { include: variantInclude, orderBy: [{ id: 'asc' }] },
} satisfies Prisma.ProductInclude

export function listWhere(q: ProductListQuery): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = {}
  if (q.type) where.type = q.type
  if (q.productTypeId) where.productTypeId = q.productTypeId
  if (q.brandId) where.brandId = q.brandId
  if (q.status !== 'all') where.isActive = q.status === 'active'
  if (q.categoryId) {
    where.OR = [{ categoryId: q.categoryId }, { category: { parentId: q.categoryId } }]
  }
  if (q.search) {
    // Name uses the trigram index; code / SKU / barcode are exact (unique indexes).
    const s = q.search
    where.AND = [
      {
        OR: [
          { name: { contains: s, mode: 'insensitive' } },
          { code: { equals: s.toUpperCase() } },
          { variants: { some: { OR: [{ sku: s.toUpperCase() }, { barcode: s }] } } },
        ],
      },
    ]
  }
  return where
}

export async function list(q: ProductListQuery) {
  const where = listWhere(q)
  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        imagePath: true,
        isActive: true,
        category: { select: { name: true, parent: { select: { name: true } } } },
        brand: { select: { name: true } },
        productType: { select: { id: true, name: true, kind: true } },
        unit: { select: { code: true } },
        variants: { select: { sellingPrice: true, stockQty: true, stockValue: true } },
      },
    }),
    prisma.product.count({ where }),
  ])
  return { items, total }
}

export function findById(id: number) {
  return prisma.product.findUnique({ where: { id }, include: productDetailInclude })
}

// Scan / type a barcode or SKU → the exact variant (used by billing and the top bar).
export function findVariantByCode(code: string) {
  return prisma.productVariant.findFirst({
    where: { OR: [{ barcode: code }, { sku: code.toUpperCase() }] },
    include: {
      ...variantInclude,
      product: {
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
          isActive: true,
          unit: { select: { code: true, allowDecimal: true } },
          taxRate: { select: { rate: true } },
        },
      },
    },
  })
}

export function findBarcodeOwners(barcodes: string[]) {
  return prisma.productVariant.findMany({
    where: { barcode: { in: barcodes } },
    select: { id: true, barcode: true, product: { select: { name: true } } },
  })
}

export function setImagePath(id: number, imagePath: string | null) {
  return prisma.product.update({ where: { id }, data: { imagePath } })
}

export function remove(id: number) {
  return prisma.product.delete({ where: { id } })
}
