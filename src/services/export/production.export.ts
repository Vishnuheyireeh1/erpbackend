import type { Response } from 'express'
import { prisma } from '../../config/prisma'
import { filterText, inBatches, sendExcel, type ExcelColumn } from '../../utils/excel'
import type { ProductionListQuery } from '../../validators/production.validator'
import { productionWhere } from '../production/production.query'

// One row per finished item made (so a batch of S / M / L shows each size with its cost).
export async function exportProduction(res: Response, q: Omit<ProductionListQuery, 'page' | 'pageSize'>, user: string) {
  const where = { order: productionWhere(q) }
  const fetch = (skip: number, take: number) =>
    prisma.productionOutput.findMany({
      where, orderBy: [{ order: { docDate: 'asc' } }, { orderId: 'asc' }, { sortOrder: 'asc' }], skip, take,
      include: { order: true, variant: { select: { sku: true, product: { select: { name: true } }, size: { select: { name: true } }, colour: { select: { name: true } } } } },
    })
  type Row = Awaited<ReturnType<typeof fetch>>[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Production no', value: (r) => r.order.docNo, width: 20 },
    { header: 'Date', value: (r) => r.order.docDate, type: 'date', width: 13 },
    { header: 'Batch', value: (r) => r.order.title, width: 22 },
    { header: 'Item made', value: (r) => [r.variant.product.name, r.variant.size?.name, r.variant.colour?.name].filter(Boolean).join(' · '), width: 32 },
    { header: 'SKU', value: (r) => r.variant.sku, width: 18 },
    { header: 'Pieces', value: (r) => r.qty, type: 'qty', width: 9 },
    { header: 'Cost / piece', value: (r) => r.unitCost, type: 'money' },
    { header: 'Stock value', value: (r) => Number(r.qty) * Number(r.unitCost), type: 'money' },
    { header: 'Batch materials', value: (r) => r.order.materialCost, type: 'money' },
    { header: 'Batch tailor', value: (r) => r.order.labourCost, type: 'money' },
    { header: 'Batch paid out', value: (r) => r.order.paidCost, type: 'money' },
    { header: 'Batch salaried (info)', value: (r) => r.order.salariedCost, type: 'money' },
    { header: 'Status', value: (r) => (r.order.status === 'POSTED' ? 'Posted' : 'Cancelled'), width: 11 },
  ]
  const filters = filterText([['Status', q.status], ['Search', q.search], ['From', q.from], ['To', q.to]])
  return sendExcel(res, { fileName: 'production', title: 'Production', filters, columns, rows: inBatches(fetch), user })
}
