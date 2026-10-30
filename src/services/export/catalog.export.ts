import type { Response } from 'express'
import { prisma } from '../../config/prisma'
import { listWhere } from '../../models/product.model'
import { filterText, inBatches, sendExcel, type ExcelColumn } from '../../utils/excel'
import type { ListQuery, MasterKey } from '../../validators/master.validator'
import type { ProductListQuery } from '../../validators/product.validator'
import { buildWhere } from '../master.service'
import { masterRegistry } from '../masters/master.registry'

const typeLabels: Record<string, string> = {
  READY_MADE: 'Ready-made', FINISHED: 'Own-made', RAW_MATERIAL: 'Raw material', ACCESSORY: 'Accessory', SERVICE: 'Service',
}

const variantSelect = {
  sku: true, barcode: true, purchasePrice: true, sellingPrice: true, mrp: true, minStock: true, stockQty: true, avgCost: true, stockValue: true, isActive: true,
  size: { select: { name: true } },
  colour: { select: { name: true } },
  product: {
    select: {
      code: true, name: true, type: true, hsnCode: true, fabric: true, isActive: true,
      productType: { select: { name: true } },
      category: { select: { name: true, parent: { select: { name: true } } } },
      unit: { select: { code: true } },
      taxRate: { select: { rate: true } },
    },
  },
} as const

type VariantRow = Awaited<ReturnType<typeof fetchVariants>>[number]
function fetchVariants(q: ProductListQuery, skip: number, take: number) {
  return prisma.productVariant.findMany({
    where: { product: listWhere(q) },
    orderBy: [{ product: { name: 'asc' } }, { id: 'asc' }],
    skip,
    take,
    select: variantSelect,
  })
}

const productColumns: ExcelColumn<VariantRow>[] = [
  { header: 'Product code', value: (v) => v.product.code, width: 12 },
  { header: 'Product name', value: (v) => v.product.name, width: 32 },
  { header: 'Type', value: (v) => v.product.productType?.name ?? typeLabels[v.product.type], width: 14 },
  { header: 'Category', value: (v) => (v.product.category.parent ? `${v.product.category.parent.name} > ${v.product.category.name}` : v.product.category.name), width: 30 },
  { header: 'Unit', value: (v) => v.product.unit.code, width: 8 },
  { header: 'HSN', value: (v) => v.product.hsnCode, width: 10 },
  { header: 'GST %', value: (v) => v.product.taxRate?.rate, type: 'number', width: 8 },
  { header: 'Fabric', value: (v) => v.product.fabric, width: 14 },
  { header: 'Size', value: (v) => v.size?.name, width: 8 },
  { header: 'Colour', value: (v) => v.colour?.name, width: 12 },
  { header: 'SKU', value: (v) => v.sku, width: 22 },
  { header: 'Barcode', value: (v) => v.barcode, width: 16 },
  { header: 'Purchase price', value: (v) => v.purchasePrice, type: 'money' },
  { header: 'Selling price', value: (v) => v.sellingPrice, type: 'money' },
  { header: 'MRP', value: (v) => v.mrp, type: 'money' },
  { header: 'Low-stock alert', value: (v) => v.minStock, type: 'qty' },
  { header: 'In stock', value: (v) => v.stockQty, type: 'qty' },
  { header: 'Cost / piece (avg)', value: (v) => v.avgCost, type: 'money' },
  { header: 'Stock value', value: (v) => v.stockValue, type: 'money' },
  { header: 'Status', value: (v) => (v.product.isActive && v.isActive ? 'Active' : 'Inactive'), width: 10 },
]

// One row per size / colour — the most useful shape for checking prices and stock in Excel.
export async function exportProducts(res: Response, q: ProductListQuery, user: string) {
  const chosen = q.productTypeId ? await prisma.productTypeMaster.findUnique({ where: { id: q.productTypeId }, select: { name: true } }) : null
  return sendExcel(res, {
    fileName: 'products',
    title: 'Products',
    filters: filterText([['Search', q.search], ['Type', chosen?.name ?? (q.type && typeLabels[q.type])], ['Status', q.status]]),
    columns: productColumns,
    rows: inBatches((skip, take) => fetchVariants(q, skip, take)),
    user,
  })
}

type MasterRow = Record<string, unknown> & { name: string; isActive: boolean }

const kindLabel = (k: unknown) => ({ READY_MADE: 'Item with stock', ACCESSORY: 'Item with stock', RAW_MATERIAL: 'Raw material', FINISHED: 'Own-made', SERVICE: 'Service (no stock)' })[String(k)] ?? String(k)

const masterColumns: Record<MasterKey, ExcelColumn<MasterRow>[]> = {
  productTypes: [{ header: 'Name', value: (r) => r.name }, { header: 'Works like', value: (r) => kindLabel(r.kind), width: 18 }, { header: 'Products', value: (r) => (r._count as { products: number }).products, type: 'number', width: 10 }],
  categories: [
    { header: 'Name', value: (r) => r.name },
    { header: 'Main category', value: (r) => (r.parent as { name: string } | null)?.name ?? '(main)' },
    { header: 'Description', value: (r) => r.description, width: 40 },
  ],
  brands: [{ header: 'Name', value: (r) => r.name }],
  units: [{ header: 'Name', value: (r) => r.name }, { header: 'Code', value: (r) => r.code, width: 10 }, { header: 'Decimals allowed', value: (r) => (r.allowDecimal ? 'Yes' : 'No'), width: 16 }],
  sizes: [{ header: 'Name', value: (r) => r.name }, { header: 'Sort order', value: (r) => r.sortOrder, type: 'number' }],
  colours: [{ header: 'Name', value: (r) => r.name }, { header: 'Colour code', value: (r) => r.hexCode ?? 'Multicolour', width: 14 }],
  taxRates: [{ header: 'Name', value: (r) => r.name }, { header: 'Rate %', value: (r) => r.rate, type: 'number', width: 10 }],
}

const masterTitles: Record<MasterKey, string> = {
  productTypes: 'Product types', categories: 'Categories', brands: 'Brands', units: 'Units', sizes: 'Sizes', colours: 'Colours', taxRates: 'GST rates',
}

export async function exportMaster(res: Response, key: MasterKey, q: ListQuery, user: string) {
  const config = masterRegistry[key]
  const rows = (await config.delegate.findMany({ where: buildWhere(key, q), orderBy: config.orderBy, include: config.include })) as unknown as MasterRow[]
  return sendExcel(res, {
    fileName: masterTitles[key].toLowerCase().replace(/\s+/g, '-'),
    title: masterTitles[key],
    filters: filterText([['Search', q.search], ['Status', q.status]]),
    columns: [...masterColumns[key], { header: 'Status', value: (r) => (r.isActive ? 'Active' : 'Inactive'), width: 10 }],
    rows: [rows],
    user,
  })
}
