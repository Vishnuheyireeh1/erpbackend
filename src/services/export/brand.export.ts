import type { Response } from 'express'
import { prisma } from '../../config/prisma'
import { filterText, inBatches, sendExcel, type ExcelColumn } from '../../utils/excel'
import { byDate } from '../../utils/order'
import type { BrandListQuery } from '../../validators/brand.validator'
import type { BrandOrderListQuery } from '../../validators/brandOrder.validator'
import * as brandService from '../brands/brand.service'
import { orderSums, orderWhere, type listOrders } from '../brands/brandOrder.query'

// Brands list → Excel (same filters as the screen).
export async function exportBrands(res: Response, q: BrandListQuery, user: string) {
  const { items } = await brandService.list({ ...q, page: 1, pageSize: Number.MAX_SAFE_INTEGER })
  type Row = (typeof items)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Code', value: (b) => b.code, width: 10 },
    { header: 'Brand', value: (b) => b.name, width: 30 },
    { header: 'Contact person', value: (b) => b.contactPerson, width: 18 },
    { header: 'Phone', value: (b) => b.phone, width: 15 },
    { header: 'Email', value: (b) => b.email, width: 24 },
    { header: 'GSTIN', value: (b) => b.gstin, width: 18 },
    { header: 'State', value: (b) => b.stateName, width: 16 },
    { header: 'City', value: (b) => b.city, width: 14 },
    { header: 'Usual GST', value: (b) => (Number(b.gstRate) ? `${Number(b.gstRate)}%` : 'No GST'), width: 11 },
    { header: 'Opening balance', value: (b) => b.openingBalance, type: 'money' },
    { header: 'Total billed', value: (b) => b.billed, type: 'money' },
    { header: 'Total received', value: (b) => b.paid, type: 'money' },
    { header: 'Pending (to receive)', value: (b) => b.balance, type: 'money' },
    { header: 'Status', value: (b) => (b.isActive ? 'Active' : 'Inactive'), width: 10 },
  ]
  return sendExcel(res, { fileName: 'brands', title: 'Brands (stitching for)', filters: filterText([['Search', q.search], ['Status', q.status], ['Only with pending', q.withDues ? 'Yes' : undefined]]), columns, rows: [items], user })
}

const VIEWS: Record<string, string> = { open: 'Open', ready: 'Ready to deliver', late: 'Late', completed: 'Completed', cancelled: 'Cancelled', all: 'All' }
const STATUS: Record<string, string> = { OPEN: 'Open', COMPLETED: 'Completed', CANCELLED: 'Cancelled' }

// Brand orders list → Excel: one row per order with pieces by stage and the order value.
export async function exportBrandOrders(res: Response, q: BrandOrderListQuery, user: string) {
  const where = orderWhere(q)
  const rows = inBatches((skip, take) =>
    prisma.brandOrder
      .findMany({ where, orderBy: byDate(q.order), skip, take, include: { items: { select: { qty: true, chargeRate: true, stage: true } }, materials: { select: { amount: true } } } })
      .then((list) => list.map(({ items, materials, ...o }) => ({ ...o, ...orderSums({ ...o, items, materials }) }))),
  )
  type Row = Awaited<ReturnType<typeof listOrders>>['items'][number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Order no.', value: (o) => o.docNo, width: 20 },
    { header: 'Received', value: (o) => o.docDate, type: 'date', width: 13 },
    { header: 'Due', value: (o) => o.expectedDate, type: 'date', width: 13 },
    { header: 'Brand', value: (o) => o.brandName, width: 26 },
    { header: 'Order no. / Bill number', value: (o) => o.theirOrderNo, width: 16 },
    { header: 'Pieces', value: (o) => o.pieces, type: 'number', width: 9 },
    { header: 'In work', value: (o) => o.inWork, type: 'number', width: 9 },
    { header: 'Ready', value: (o) => o.ready, type: 'number', width: 9 },
    { header: 'Delivered', value: (o) => o.delivered, type: 'number', width: 10 },
    { header: 'Order value', value: (o) => o.value, type: 'money' },
    { header: 'Status', value: (o) => STATUS[o.status] ?? o.status, width: 11 },
    { header: 'Label note', value: (o) => o.labelNote, width: 28 },
  ]
  return sendExcel(res, {
    fileName: 'brand-orders',
    title: 'Brand orders',
    filters: filterText([['Show', VIEWS[q.view]], ['Search', q.search], ['From', q.from], ['To', q.to]]),
    columns,
    rows,
    user,
  })
}
