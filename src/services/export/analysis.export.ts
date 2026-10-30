import type { Response } from 'express'
import { sendExcel, type ExcelColumn } from '../../utils/excel'
import { purchasesByItem, purchasesBySupplier, salesByCategory, salesByCustomer } from '../reports/analysis.report'
import { itemProfit, type ItemKind } from '../reports/itemProfit.report'
import { slowMoving, stockOnDate, whoOwes } from '../reports/stock.report'

type Range = { from?: string; to?: string }
const money = <T,>(header: string, value: (r: T) => unknown): ExcelColumn<T> => ({ header, value, type: 'money' })

export async function exportSalesByCategory(res: Response, q: Range, user: string) {
  const r = await salesByCategory(q)
  type Row = { category: string; qty: number | null; amount: number; profit: number | null }
  const rows: Row[] = [...r.items, { category: `Stitching charges (${r.stitching.jobs} jobs)`, qty: null, amount: r.stitching.amount, profit: null }, { category: 'TOTAL', qty: null, amount: r.total, profit: null }]
  const columns: ExcelColumn<Row>[] = [{ header: 'Category', value: (x) => x.category, width: 34 }, { header: 'Qty sold', value: (x) => x.qty, type: 'qty' }, money('Sales (GST incl.)', (x) => x.amount), money('Profit (before GST)', (x) => x.profit)]
  return sendExcel(res, { fileName: 'sales-by-category', title: 'Sales by category', filters: [`${r.from} to ${r.to}`, 'Net of returns'], columns, rows: [rows], user })
}

export async function exportSalesByCustomer(res: Response, q: Range, user: string) {
  const r = await salesByCustomer(q)
  type Row = (typeof r.items)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Customer', value: (x) => x.name, width: 28 }, { header: 'Phone', value: (x) => x.phone, width: 14 },
    money('Counter bills', (x) => x.bills), money('Job bills', (x) => x.jobs), money('Returns', (x) => x.returns), money('Total', (x) => x.total),
    { header: 'Visits', value: (x) => x.visits, type: 'number', width: 8 }, { header: 'Last visit', value: (x) => x.lastVisit, type: 'date', width: 13 },
  ]
  return sendExcel(res, { fileName: 'sales-by-customer', title: 'Sales by customer', filters: [`${r.from} to ${r.to}`], columns, rows: [r.items], user })
}

export async function exportWhoOwes(res: Response, user: string) {
  const r = await whoOwes()
  type Row = (typeof r.items)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Code', value: (x) => x.code, width: 9 }, { header: 'Customer', value: (x) => x.name, width: 26 }, { header: 'Phone', value: (x) => x.phone, width: 14 },
    money('Up to 30 days', (x) => x.upTo30), money('31–60 days', (x) => x.d31to60), money('61–90 days', (x) => x.d61to90), money('Over 90 days', (x) => x.over90),
    money('Old balance / advance', (x) => x.other), money('Total owed', (x) => x.owed), { header: 'Oldest unpaid bill', value: (x) => x.oldestBill, type: 'date', width: 14 },
  ]
  return sendExcel(res, { fileName: 'who-owes', title: 'Who owes the shop', filters: [`Total ₹${r.total.owed} · ${r.items.length} customers`], columns, rows: [r.items], user })
}

export async function exportStockOnDate(res: Response, q: { date?: string; search?: string }, user: string) {
  const r = await stockOnDate({ ...q, page: 1, pageSize: 100_000 })
  type Row = (typeof r.items)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Item', value: (x) => x.name, width: 34 }, { header: 'SKU', value: (x) => x.sku, width: 18 }, { header: 'Category', value: (x) => x.category, width: 18 },
    { header: 'Stock', value: (x) => x.qty, type: 'qty' }, { header: 'Unit', value: (x) => x.unit, width: 6 }, money('Avg cost', (x) => x.avgCost), money('Stock value', (x) => x.value),
  ]
  return sendExcel(res, { fileName: `stock-on-${r.date}`, title: `Stock on ${r.date}`, filters: [`Total value ₹${r.value} · ${r.total} items`], columns, rows: [r.items], user })
}

export async function exportSlowMoving(res: Response, q: { days?: number; search?: string }, user: string) {
  const r = await slowMoving({ ...q, page: 1, pageSize: 100_000 })
  type Row = (typeof r.items)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Item', value: (x) => x.name, width: 34 }, { header: 'SKU', value: (x) => x.sku, width: 18 }, { header: 'Category', value: (x) => x.category, width: 18 },
    { header: 'Stock', value: (x) => x.qty, type: 'qty' }, { header: 'Unit', value: (x) => x.unit, width: 6 }, money('Stock value', (x) => x.value),
    { header: 'Last sold / used', value: (x) => x.lastSold, type: 'date', width: 14 }, { header: 'Days idle', value: (x) => x.idleDays, type: 'number', width: 10 },
  ]
  return sendExcel(res, { fileName: 'slow-moving-stock', title: `Not sold for ${r.days}+ days`, filters: [`Stuck value ₹${r.value} · ${r.total} items`], columns, rows: [r.items], user })
}

export async function exportPurchases(res: Response, q: Range & { by?: string }, user: string) {
  if (q.by === 'item') {
    const r = await purchasesByItem({ ...q, limit: 5000 })
    type Row = (typeof r.items)[number]
    const columns: ExcelColumn<Row>[] = [
      { header: 'Item', value: (x) => x.name, width: 34 }, { header: 'SKU', value: (x) => x.sku, width: 18 }, { header: 'Qty bought', value: (x) => x.qty, type: 'qty' },
      { header: 'Unit', value: (x) => x.unit, width: 6 }, money('Value before GST', (x) => x.taxable), money('Avg rate', (x) => x.avgRate), { header: 'Suppliers', value: (x) => x.suppliers, width: 30 },
    ]
    return sendExcel(res, { fileName: 'purchases-by-item', title: 'Purchases by item', filters: [`${r.from} to ${r.to}`, 'Net of purchase returns'], columns, rows: [r.items], user })
  }
  const r = await purchasesBySupplier(q)
  type Row = (typeof r.items)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Supplier', value: (x) => x.name, width: 28 }, { header: 'Bills', value: (x) => x.bills, type: 'number', width: 7 },
    money('Before GST', (x) => x.taxable), money('GST', (x) => x.gst), money('Bill total', (x) => x.total), money('Paid', (x) => x.paid), money('Returned', (x) => x.returned), money('Still to pay', (x) => x.due),
  ]
  return sendExcel(res, { fileName: 'purchases-by-supplier', title: 'Purchases by supplier', filters: [`${r.from} to ${r.to}`], columns, rows: [r.items], user })
}

// Same order as the screen: sale items, stitching jobs, brand orders.
const KIND_LABEL: Record<ItemKind, string> = { SALE: 'Sale item', STITCHING: 'Stitching job', BRAND: 'Brand order' }
const KIND_ORDER: ItemKind[] = ['SALE', 'STITCHING', 'BRAND']
export async function exportItemProfit(res: Response, q: Range & { kind?: ItemKind }, user: string) {
  const r = await itemProfit(q)
  type Row = (typeof r.rows)[number] | (typeof r.totals & { kind: null; item: string; avgRate: null; marginPct: null })
  const sorted = [...r.rows].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.total - a.total)
  const rows: Row[] = [...sorted, { ...r.totals, kind: null, item: 'TOTAL', avgRate: null, marginPct: null }]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Item', value: (x) => x.item, width: 28 }, { header: 'Type', value: (x) => (x.kind ? KIND_LABEL[x.kind] : ''), width: 14 },
    { header: 'Pieces / qty', value: (x) => x.pieces, type: 'qty' }, money('Avg rate', (x) => x.avgRate), money('Total (before GST)', (x) => x.total),
    money('Tailor pay', (x) => x.tailor), money('Embroidery', (x) => x.embroidery), money('Other costs', (x) => x.other),
    money('Cloth / item cost', (x) => x.cloth), money('Profit', (x) => x.profit), { header: 'Margin %', value: (x) => x.marginPct, type: 'number', width: 10 },
  ]
  const filters = [`${r.from} to ${r.to}`, r.kind ? `${KIND_LABEL[r.kind]}s` : 'Sale items, stitching jobs and brand orders']
  return sendExcel(res, { fileName: 'profit-by-item', title: 'Profit by item', filters, columns, rows: [rows], user })
}
