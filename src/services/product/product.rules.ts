import { prisma } from '../../config/prisma'
import * as productModel from '../../models/product.model'
import { ApiError } from '../../utils/ApiError'
import type { ProductInput } from '../../validators/product.validator'

type NameMap = Map<number, string>

// Checks everything the database can't express nicely, before saving.
// Returns size / colour names (needed to build SKUs) and the product type with its kind.
export async function checkProduct(input: ProductInput, productId?: number) {
  await checkMasters(input)
  const typeData = await resolveType(input)
  checkVariantShape(input)
  const names = await loadVariantNames(input)
  await checkBarcodes(input, productId)
  return { ...names, typeData }
}

// Product type → its kind (stock / sales rules read Product.type). Only a kind sent (import, old screens)
// → the first type of that kind.
async function resolveType(input: ProductInput) {
  if (input.productTypeId) {
    const t = await prisma.productTypeMaster.findUnique({ where: { id: input.productTypeId } })
    if (!t) throw ApiError.badRequest('Selected product type no longer exists')
    return { productTypeId: t.id, type: t.kind }
  }
  if (!input.type) throw ApiError.badRequest('Choose a product type')
  const t = await prisma.productTypeMaster.findFirst({ where: { kind: input.type }, orderBy: { id: 'asc' } })
  return { productTypeId: t?.id ?? null, type: input.type }
}

async function checkMasters(input: ProductInput) {
  const [category, unit, brand, tax] = await Promise.all([
    prisma.category.findUnique({ where: { id: input.categoryId } }),
    prisma.unit.findUnique({ where: { id: input.unitId } }),
    input.brandId ? prisma.brand.findUnique({ where: { id: input.brandId } }) : null,
    input.taxRateId ? prisma.taxRate.findUnique({ where: { id: input.taxRateId } }) : null,
  ])
  if (!category) throw ApiError.badRequest('Selected category no longer exists')
  if (!unit) throw ApiError.badRequest('Selected unit no longer exists')
  if (input.brandId && !brand) throw ApiError.badRequest('Selected brand no longer exists')
  if (input.taxRateId && !tax) throw ApiError.badRequest('Selected GST rate no longer exists')
}

function checkVariantShape(input: ProductInput) {
  const { variants } = input
  if (variants.length > 1 && variants.some((v) => !v.sizeId && !v.colourId)) {
    throw ApiError.badRequest('With more than one variant, each needs a size or a colour')
  }
  const seen = new Set<string>()
  for (const v of variants) {
    const combo = `${v.sizeId ?? '-'}:${v.colourId ?? '-'}`
    if (seen.has(combo)) throw ApiError.badRequest('Two variants have the same size and colour')
    seen.add(combo)
  }
}

async function loadVariantNames(input: ProductInput) {
  const sizeIds = [...new Set(input.variants.map((v) => v.sizeId).filter((id): id is number => !!id))]
  const colourIds = [...new Set(input.variants.map((v) => v.colourId).filter((id): id is number => !!id))]
  const [sizes, colours] = await Promise.all([
    prisma.size.findMany({ where: { id: { in: sizeIds } }, select: { id: true, name: true } }),
    prisma.colour.findMany({ where: { id: { in: colourIds } }, select: { id: true, name: true } }),
  ])
  if (sizes.length !== sizeIds.length) throw ApiError.badRequest('A selected size no longer exists')
  if (colours.length !== colourIds.length) throw ApiError.badRequest('A selected colour no longer exists')
  return {
    sizeNames: new Map(sizes.map((s) => [s.id, s.name])) as NameMap,
    colourNames: new Map(colours.map((c) => [c.id, c.name])) as NameMap,
  }
}

// Manually typed barcodes (supplier barcodes) must be unique everywhere.
async function checkBarcodes(input: ProductInput, productId?: number) {
  const typed = input.variants.map((v) => v.barcode).filter((b): b is string => !!b)
  if (new Set(typed).size !== typed.length) {
    throw ApiError.badRequest('The same barcode is used on two variants')
  }
  if (typed.length === 0) return

  const ownIds = new Set(input.variants.map((v) => v.id).filter(Boolean))
  const owners = await productModel.findBarcodeOwners(typed)
  const clash = owners.find((o) => !ownIds.has(o.id))
  if (clash) {
    throw ApiError.conflict(`Barcode ${clash.barcode} is already used by "${clash.product.name}"`)
  }

  if (productId !== undefined && ownIds.size > 0) {
    const foreign = await prisma.productVariant.count({
      where: { id: { in: [...ownIds] as number[] }, productId: { not: productId } },
    })
    if (foreign > 0) throw ApiError.badRequest('A variant does not belong to this product')
  }
}
