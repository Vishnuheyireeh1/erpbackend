import type { Response } from 'express'
import { sendExcel, type ExcelColumn } from '../../utils/excel'
import { gstSummary, hsnSummary, purchaseRegister, salesRegister } from '../reports/gst.service'
import { salesByDay, topItems } from '../reports/sales.report'

type Range = { from?: string; to?: string }
const kindLabels: Record<string, string> = { BILL: 'Sales bill', JOB: 'Job bill', RETURN: 'Sales return (credit note)', PURCHASE: 'Purchase bill', PURCHASE_RETURN: 'Purchase return (debit note)' }
const taxCols = <T extends { taxable: number; cgst: number; sgst: number; igst: number }>(): ExcelColumn<T>[] => [
  { header: 'Taxable', value: (r) => r.taxable, type: 'money' },
  { header: 'CGST', value: (r) => r.cgst, type: 'money' },
  { header: 'SGST', value: (r) => r.sgst, type: 'money' },
  { header: 'IGST', value: (r) => r.igst, type: 'money' },
]

export async function exportSalesByDay(res: Response, q: Range, user: string) {
  const r = await salesByDay(q)
  type Row = (typeof r.days)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Date', value: (d) => new Date(`${d.date}T00:00:00Z`), type: 'date', width: 13 },
    { header: 'Bills', value: (d) => d.billCount, type: 'number', width: 8 },
    { header: 'Counter sales', value: (d) => d.bills, type: 'money' },
    { header: 'Jobs booked', value: (d) => d.jobCount, type: 'number', width: 8 },
    { header: 'Job bills', value: (d) => d.jobs, type: 'money' },
    { header: 'Returns', value: (d) => d.returns, type: 'money' },
    { header: 'Net sales', value: (d) => d.net, type: 'money' },
  ]
  return sendExcel(res, { fileName: 'sales-by-day', title: 'Sales by day', filters: [`${r.from} to ${r.to}`, 'GST included, as billed'], columns, rows: [r.days], user })
}

export async function exportTopItems(res: Response, q: Range, user: string) {
  const r = await topItems({ ...q, limit: 500 })
  type Row = (typeof r.items)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Item', value: (i) => i.name, width: 36 },
    { header: 'Qty sold', value: (i) => i.qty, type: 'qty', width: 10 },
    { header: 'Sales (GST incl.)', value: (i) => i.amount, type: 'money' },
    { header: 'Profit (before GST)', value: (i) => i.profit, type: 'money' },
  ]
  return sendExcel(res, { fileName: 'items-sold', title: 'Items sold', filters: [`${r.from} to ${r.to}`, 'Net of returns'], columns, rows: [r.items], user })
}

export async function exportGstSummary(res: Response, q: Range, user: string) {
  const s = await gstSummary(q)
  type Row = { section: string; name: string; taxable: number; cgst: number; sgst: number; igst: number }
  const rows: Row[] = [
    ...s.outward.map((r) => ({ section: 'Sales (output tax)', name: `GST ${r.rate}%`, ...r })),
    { section: 'Sales (output tax)', name: 'TOTAL SALES', ...s.outwardTotal },
    { section: '  of which', name: 'To GST customers (B2B)', ...s.split.b2b },
    { section: '  of which', name: 'To others (B2C)', ...s.split.b2c },
    { section: '  of which', name: 'Returns (credit notes)', ...s.split.returns },
    ...s.inward.map((r) => ({ section: 'Purchases (input credit)', name: `GST ${r.rate}%`, ...r })),
    { section: 'Purchases (input credit)', name: 'TOTAL PURCHASES', ...s.inwardTotal },
    { section: '', name: 'GST TO PAY (output − input)', taxable: 0, ...s.payable },
  ]
  const columns: ExcelColumn<Row>[] = [{ header: 'Section', value: (r) => r.section, width: 24 }, { header: 'Item', value: (r) => r.name, width: 30 }, ...taxCols<Row>()]
  return sendExcel(res, { fileName: 'gst-summary', title: 'GST summary', filters: [`${s.from} to ${s.to}`, 'For the accountant — check before filing'], columns, rows: [rows], user })
}

type DocRow = Awaited<ReturnType<typeof salesRegister>>['items'][number]
const docColumns = (purchase: boolean): ExcelColumn<DocRow>[] => [
  { header: 'Date', value: (r) => r.date, type: 'date', width: 13 },
  { header: 'Document', value: (r) => r.docNo, width: 20 },
  ...(purchase ? [{ header: 'Supplier bill no', value: (r: DocRow) => r.billNo, width: 16 }] : []),
  { header: 'Type', value: (r) => kindLabels[r.kind] ?? r.kind, width: 22 },
  { header: purchase ? 'Supplier' : 'Customer', value: (r) => r.party, width: 26 },
  { header: 'GSTIN', value: (r) => r.gstin, width: 18 },
  { header: 'GST %', value: (r) => r.rates, width: 10 },
  ...taxCols<DocRow>(),
  { header: 'Total', value: (r) => r.total, type: 'money' },
]

export async function exportSalesRegister(res: Response, q: Range & { b2b?: boolean }, user: string) {
  const r = await salesRegister(q)
  const title = q.b2b ? 'GST sales — B2B (customers with GSTIN)' : 'GST sales register'
  return sendExcel(res, { fileName: q.b2b ? 'gst-sales-b2b' : 'gst-sales-register', title, filters: [`${r.from} to ${r.to}`], columns: docColumns(false), rows: [r.items], user })
}

export async function exportPurchaseRegister(res: Response, q: Range, user: string) {
  const r = await purchaseRegister(q)
  return sendExcel(res, { fileName: 'gst-purchase-register', title: 'GST purchase register', filters: [`${r.from} to ${r.to}`], columns: docColumns(true), rows: [r.items], user })
}

export async function exportHsn(res: Response, q: Range, user: string) {
  const r = await hsnSummary(q)
  type Row = (typeof r.items)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'HSN / SAC', value: (h) => h.hsn || '(missing)', width: 12 },
    { header: 'GST %', value: (h) => h.rate, type: 'qty', width: 8 },
    { header: 'Qty', value: (h) => h.qty, type: 'qty', width: 10 },
    ...taxCols<Row>(),
    { header: 'Total tax', value: (h) => h.tax, type: 'money' },
  ]
  return sendExcel(res, { fileName: 'gst-hsn-summary', title: 'HSN summary (sales)', filters: [`${r.from} to ${r.to}`, '9988 = stitching service'], columns, rows: [r.items], user })
}
