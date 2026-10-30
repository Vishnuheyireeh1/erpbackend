import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { nextValue } from '../../models/counter.model'
import { productDetailInclude } from '../../models/product.model'
import { ApiError } from '../../utils/ApiError'
import { internalEan13, productCode, variantSku } from '../../utils/codes'
import type { ProductInput, VariantInput } from '../../validators/product.validator'
import { checkProduct } from './product.rules'

type Names = Awaited<ReturnType<typeof checkProduct>>
type Tx = Prisma.TransactionClient

const TX_OPTIONS = { timeout: 20_000 }

function productData(input: ProductInput, names: Names) {
  const { variants: _variants, type: _type, productTypeId: _typeId, ...data } = input
  return { ...data, ...names.typeData }
}

function variantData(v: VariantInput) {
  return {
    sizeId: v.sizeId,
    colourId: v.colourId,
    purchasePrice: v.purchasePrice,
    sellingPrice: v.sellingPrice,
    mrp: v.mrp,
    minStock: v.minStock,
    isActive: v.isActive,
  }
}

// Creates new variant rows: SKU from product code + size + colour; EAN-13 unless a barcode was typed.
async function createVariants(tx: Tx, productId: number, code: string, variants: VariantInput[], names: Names) {
  if (variants.length === 0) return
  const needBarcodes = variants.filter((v) => !v.barcode).length
  let next = needBarcodes > 0 ? await nextValue(tx, 'barcode', needBarcodes) : 0

  await tx.productVariant.createMany({
    data: variants.map((v) => ({
      productId,
      ...variantData(v),
      sku: variantSku(code, v.sizeId ? names.sizeNames.get(v.sizeId) : null, v.colourId ? names.colourNames.get(v.colourId) : null),
      barcode: v.barcode ?? internalEan13(next++),
    })),
  })
}

export async function createProduct(input: ProductInput) {
  if (input.variants.some((v) => v.id)) throw ApiError.badRequest('New products cannot have variant ids')
  const names = await checkProduct(input)

  return prisma.$transaction(async (tx) => {
    const code = productCode(await nextValue(tx, 'product'))
    const product = await tx.product.create({ data: { ...productData(input, names), code } })
    await createVariants(tx, product.id, code, input.variants, names)
    return tx.product.findUniqueOrThrow({ where: { id: product.id }, include: productDetailInclude })
  }, TX_OPTIONS)
}

// Variants: kept ids are updated, new rows created, missing ids deleted.
// SKU and generated barcode never change once printed — only a typed barcode replaces it.
export async function updateProduct(id: number, input: ProductInput) {
  const existing = await prisma.product.findUnique({ where: { id }, include: { variants: true } })
  if (!existing) throw ApiError.notFound('Product not found')

  const names = await checkProduct(input, id)
  const existingIds = new Set(existing.variants.map((v) => v.id))
  const kept = input.variants.filter((v) => v.id && existingIds.has(v.id))
  const added = input.variants.filter((v) => !v.id)
  if (kept.length + added.length !== input.variants.length) {
    throw ApiError.badRequest('A variant does not belong to this product')
  }
  const byId = new Map(existing.variants.map((v) => [v.id, v]))
  const changedCombo = kept.find((v) => {
    const old = byId.get(v.id!)!
    return old.sizeId !== v.sizeId || old.colourId !== v.colourId
  })
  if (changedCombo) {
    throw ApiError.badRequest("A saved variant's size or colour can't change — remove it and add a new one")
  }
  const keptIds = new Set(kept.map((v) => v.id))
  const removedIds = existing.variants.filter((v) => !keptIds.has(v.id)).map((v) => v.id)
  if (removedIds.length > 0) {
    const withHistory = await prisma.productVariant.findFirst({
      where: { id: { in: removedIds }, movements: { some: {} } },
      select: { sku: true },
    })
    if (withHistory) {
      throw ApiError.conflict(`${withHistory.sku} has stock history, so it can't be removed — untick Active instead`)
    }
  }

  return prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id }, data: productData(input, names) })
    if (removedIds.length > 0) {
      // Later modules: blocked by stock / bill rows referencing the variant (FK Restrict).
      await tx.productVariant.deleteMany({ where: { id: { in: removedIds } } })
    }
    for (const v of kept) {
      await tx.productVariant.update({
        where: { id: v.id },
        data: { ...variantData(v), ...(v.barcode ? { barcode: v.barcode } : {}) },
      })
    }
    await createVariants(tx, id, existing.code, added, names)
    return tx.product.findUniqueOrThrow({ where: { id }, include: productDetailInclude })
  }, TX_OPTIONS)
}
