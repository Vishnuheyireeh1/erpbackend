import { prisma } from '../config/prisma'
import * as productModel from '../models/product.model'
import { ApiError } from '../utils/ApiError'
import type { ProductListQuery } from '../validators/product.validator'
import { deleteProductImage, saveProductImage } from './product/product.image'
import { makingStats } from './product/product.making'

export { createProduct, updateProduct } from './product/product.save'

// List rows carry a price range instead of every variant. An Own-made list (filtered to a type that works like
// Own-made) also gets making stats.
export async function list(query: ProductListQuery) {
  const { items, total } = await productModel.list(query)
  const ownMade = query.type === 'FINISHED' || (!!query.productTypeId && items.length > 0 && items.every((p) => p.type === 'FINISHED'))
  const made = ownMade ? await makingStats(items.map((p) => p.id)) : null
  const rows = items.map(({ variants, ...p }) => {
    const prices = variants.map((v) => Number(v.sellingPrice))
    const totalStock = variants.reduce((sum, v) => sum + Number(v.stockQty), 0)
    const stockValue = variants.reduce((sum, v) => sum + Number(v.stockValue), 0)
    const m = made?.get(p.id)
    return {
      ...p,
      variantCount: variants.length,
      totalStock,
      minPrice: prices.length ? Math.min(...prices) : 0,
      maxPrice: prices.length ? Math.max(...prices) : 0,
      // Cost of one piece: average of what is in stock, else the latest making.
      costPerPiece: totalStock > 0 ? Math.round((stockValue / totalStock) * 100) / 100 : (m?.lastUnitCost ?? null),
      ...(made ? { timesMade: m?.timesMade ?? 0, piecesMade: m?.piecesMade ?? 0, lastMade: m?.lastMade ?? null } : {}),
    }
  })
  return { items: rows, total, page: query.page, pageSize: query.pageSize }
}

export async function getById(id: number) {
  const product = await productModel.findById(id)
  if (!product) throw ApiError.notFound('Product not found')
  return product
}

// Barcode / SKU scan → one variant.
export async function lookup(code: string) {
  const trimmed = code.trim()
  if (!trimmed) throw ApiError.badRequest('Enter a barcode or SKU')
  const variant = await productModel.findVariantByCode(trimmed)
  if (!variant) throw ApiError.notFound(`No product found for "${trimmed}"`)
  return variant
}

// Hard delete — only while the product has no stock history (history must never disappear).
export async function remove(id: number) {
  const product = await getById(id)
  const history = await prisma.stockMovement.count({ where: { variant: { productId: id } } })
  if (history > 0) {
    throw ApiError.conflict(`"${product.name}" has stock history, so it can't be deleted — make it Inactive instead`)
  }
  await productModel.remove(id)
  await deleteProductImage(product.imagePath)
}

export async function setImage(id: number, file: Buffer | undefined) {
  if (!file) throw ApiError.badRequest('Choose an image to upload')
  const product = await getById(id)
  const imagePath = await saveProductImage(file)
  await productModel.setImagePath(id, imagePath)
  await deleteProductImage(product.imagePath)
  return imagePath
}

export async function removeImage(id: number) {
  const product = await getById(id)
  await productModel.setImagePath(id, null)
  await deleteProductImage(product.imagePath)
}
