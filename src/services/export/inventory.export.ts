import { byDate } from '../../utils/order'
import type { Response } from 'express'
import { prisma } from '../../config/prisma'
import { baseWhere, statusWhere } from '../../models/stock.model'
import { docWhere } from '../../models/stockDocument.model'
import { ApiError } from '../../utils/ApiError'
import { filterText, inBatches, sendExcel, type ExcelColumn } from '../../utils/excel'
import type { DocumentListQuery, StockListQuery } from '../../validators/inventory.validator'

const movementLabels: Record<string, string> = {
  OPENING: 'Opening stock', ADJUSTMENT_IN: 'Adjustment +', ADJUSTMENT_OUT: 'Adjustment −', PURCHASE: 'Purchase',
  PURCHASE_RETURN: 'Purchase return', SALE: 'Sale', SALE_RETURN: 'Sale return', JOB_CONSUMPTION: 'Used in job',
  PRODUCTION_IN: 'Produced', PRODUCTION_OUT: 'Used in production', CANCELLATION: 'Cancelled',
}
const reasonLabels: Record<string, string> = {
  OPENING: 'Opening stock', DAMAGED: 'Damaged', LOST: 'Lost / theft', FOUND: 'Found extra',
  COUNT_CORRECTION: 'Count correction', SAMPLE: 'Sample / gift', OTHER: 'Other',
}
const statusLabels = { all: 'All items', in: 'In stock', low: 'Low stock', out: 'Out of stock', available: 'Has stock' }

const stockSelect = {
  sku: true, barcode: true, stockQty: true, minStock: true, avgCost: true, stockValue: true, sellingPrice: true,
  size: { select: { name: true } },
  colour: { select: { name: true } },
  product: { select: { name: true, unit: { select: { code: true } }, category: { select: { name: true, parent: { select: { name: true } } } } } },
} as const

type StockRow = Awaited<ReturnType<typeof fetchStock>>[number]
function fetchStock(q: StockListQuery, skip: number, take: number) {
  return prisma.productVariant.findMany({
    where: { AND: [baseWhere(q), statusWhere(q.status)] },
    orderBy: [{ product: { name: 'asc' } }, { id: 'asc' }],
    skip,
    take,
    select: stockSelect,
  })
}

const stockState = (r: StockRow) => (Number(r.stockQty) <= 0 ? 'Out of stock' : Number(r.stockQty) <= Number(r.minStock) ? 'Low stock' : 'In stock')

const stockColumns: ExcelColumn<StockRow>[] = [
  { header: 'Product', value: (r) => r.product.name, width: 32 },
  { header: 'Size', value: (r) => r.size?.name, width: 8 },
  { header: 'Colour', value: (r) => r.colour?.name, width: 12 },
  { header: 'SKU', value: (r) => r.sku, width: 22 },
  { header: 'Barcode', value: (r) => r.barcode, width: 16 },
  { header: 'Category', value: (r) => (r.product.category.parent ? `${r.product.category.parent.name} > ${r.product.category.name}` : r.product.category.name), width: 28 },
  { header: 'Unit', value: (r) => r.product.unit.code, width: 8 },
  { header: 'In stock', value: (r) => r.stockQty, type: 'qty' },
  { header: 'Low-stock alert', value: (r) => r.minStock, type: 'qty' },
  { header: 'Average cost', value: (r) => r.avgCost, type: 'money' },
  { header: 'Stock value', value: (r) => r.stockValue, type: 'money' },
  { header: 'Selling price', value: (r) => r.sellingPrice, type: 'money' },
  { header: 'Status', value: stockState, width: 14 },
]

export function exportStock(res: Response, q: StockListQuery, user: string) {
  return sendExcel(res, {
    fileName: 'stock',
    title: 'Stock',
    filters: filterText([['Show', statusLabels[q.status]], ['Search', q.search]]),
    columns: stockColumns,
    rows: inBatches((skip, take) => fetchStock(q, skip, take)),
    user,
  })
}

// Full history of one item, oldest first (running balance reads naturally top → bottom).
export async function exportLedger(res: Response, variantId: number, user: string, dir: 'asc' | 'desc' = 'desc') {
  const item = await prisma.productVariant.findUnique({ where: { id: variantId }, select: { sku: true, product: { select: { name: true } } } })
  if (!item) throw ApiError.notFound('Item not found')
  type Row = Awaited<ReturnType<typeof prisma.stockMovement.findMany>>[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Date', value: (m) => m.movementDate, type: 'date', width: 13 },
    { header: 'Document', value: (m) => m.refNo, width: 20 },
    { header: 'Type', value: (m) => movementLabels[m.type], width: 18 },
    { header: 'In', value: (m) => (Number(m.qty) > 0 ? m.qty : null), type: 'qty' },
    { header: 'Out', value: (m) => (Number(m.qty) < 0 ? -Number(m.qty) : null), type: 'qty' },
    { header: 'Cost / unit', value: (m) => m.unitCost, type: 'money' },
    { header: 'Value', value: (m) => m.value, type: 'money' },
    { header: 'Balance qty', value: (m) => m.balanceQty, type: 'qty' },
    { header: 'Balance value', value: (m) => m.balanceValue, type: 'money' },
    { header: 'Note', value: (m) => m.note, width: 36 },
    { header: 'By', value: (m) => m.createdBy, width: 18 },
  ]
  return sendExcel(res, {
    fileName: `stock-history-${item.sku}`,
    title: `Stock history — ${item.product.name} (${item.sku})`,
    columns,
    rows: inBatches((skip, take) => prisma.stockMovement.findMany({ where: { variantId }, orderBy: { id: dir }, skip, take })),
    user,
  })
}

export async function exportStockDocuments(res: Response, q: DocumentListQuery, user: string) {
  const docs = await prisma.stockDocument.findMany({
    where: docWhere(q),
    orderBy: byDate(q.order),
    include: { _count: { select: { lines: true } } },
  })
  type Row = (typeof docs)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Document', value: (d) => d.docNo, width: 20 },
    { header: 'Date', value: (d) => d.docDate, type: 'date', width: 13 },
    { header: 'Kind', value: (d) => (d.kind === 'OPENING' ? 'Opening stock' : 'Adjustment'), width: 14 },
    { header: 'Reason', value: (d) => reasonLabels[d.reason], width: 18 },
    { header: 'Items', value: (d) => d._count.lines, type: 'number', width: 8 },
    { header: 'Value', value: (d) => d.totalValue, type: 'money' },
    { header: 'Status', value: (d) => (d.status === 'POSTED' ? 'Posted' : 'Cancelled'), width: 11 },
    { header: 'Note', value: (d) => d.note, width: 30 },
    { header: 'Saved by', value: (d) => d.createdBy, width: 18 },
    { header: 'Cancel reason', value: (d) => d.cancelReason, width: 30 },
  ]
  return sendExcel(res, {
    fileName: 'stock-documents',
    title: 'Stock documents',
    filters: filterText([['Kind', q.kind], ['From', q.from], ['To', q.to]]),
    columns,
    rows: [docs],
    user,
  })
}
