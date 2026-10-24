import type { Response } from 'express'
import { filterText, sendExcel, type ExcelColumn } from '../../utils/excel'
import type { BrandReportQuery } from '../../validators/brandBill.validator'
import { listBills } from '../brands/brandBill.query'
import { listPayments, statement } from '../brands/brandPayment.service'
import { brandSummary, clothReport, orderProfit, pendingWork } from '../reports/brand.report'

// Excel for every brand list / report (same filters as the screen).

type Col<T> = ExcelColumn<T>
const STAGE: Record<string, string> = { IN_WORK: 'In work', READY: 'Ready', DELIVERED: 'Delivered' }
const filters = (q: BrandReportQuery & { from?: string; to?: string }) => filterText([['From', q.from], ['To', q.to]])

export async function exportBrandReport(res: Response, kind: string, q: BrandReportQuery, user: string) {
  if (kind === 'summary') {
    const r = await brandSummary(q)
    type R = (typeof r.rows)[number]
    const columns: Col<R>[] = [
      { header: 'Code', value: (x) => x.code, width: 9 }, { header: 'Brand', value: (x) => x.name, width: 26 },
      { header: 'Orders', value: (x) => x.orders, type: 'number', width: 9 }, { header: 'Pieces ordered', value: (x) => x.piecesOrdered, type: 'number' },
      { header: 'Pieces delivered', value: (x) => x.piecesDelivered, type: 'number' }, { header: 'Billed', value: (x) => x.billed, type: 'money' },
      { header: 'Income (before GST)', value: (x) => x.income, type: 'money' }, { header: 'Received', value: (x) => x.received, type: 'money' },
      { header: 'Pending today', value: (x) => x.pending, type: 'money' },
    ]
    return sendExcel(res, { fileName: 'brand-summary', title: 'Brand summary', filters: filters(r), columns, rows: [r.rows], user })
  }
  if (kind === 'pending-work') {
    const r = await pendingWork(q)
    type R = (typeof r.rows)[number]
    const columns: Col<R>[] = [
      { header: 'Order', value: (x) => x.docNo, width: 20 }, { header: 'Brand', value: (x) => x.brand, width: 22 }, { header: 'Order / bill no.', value: (x) => x.theirOrderNo, width: 14 },
      { header: 'Due', value: (x) => x.due, type: 'date', width: 13 }, { header: 'Late', value: (x) => (x.late ? 'Late' : ''), width: 7 },
      { header: 'Piece', value: (x) => x.piece, width: 20 }, { header: 'For', value: (x) => x.endCustomer, width: 18 }, { header: 'Qty', value: (x) => x.qty, type: 'number', width: 7 },
      { header: 'Tailor', value: (x) => x.tailor, width: 16 }, { header: 'Stage', value: (x) => STAGE[x.stage], width: 10 }, { header: 'Value', value: (x) => x.value, type: 'money' },
    ]
    return sendExcel(res, { fileName: 'brand-pending-work', title: 'Brand pieces not delivered', columns, rows: [r.rows], user })
  }
  if (kind === 'profit') {
    const r = await orderProfit(q)
    type R = (typeof r.rows)[number]
    const columns: Col<R>[] = [
      { header: 'Order', value: (x) => x.docNo, width: 20 }, { header: 'Received', value: (x) => x.docDate, type: 'date', width: 13 }, { header: 'Brand', value: (x) => x.brand, width: 22 },
      { header: 'Pieces', value: (x) => x.pieces, type: 'number', width: 8 }, { header: 'Delivered', value: (x) => x.delivered, type: 'number', width: 9 },
      { header: 'Billed (before GST)', value: (x) => x.billed, type: 'money' }, { header: 'Our cloth', value: (x) => x.ourCloth, type: 'money' },
      { header: 'Tailor pay', value: (x) => x.tailorPay, type: 'money' }, { header: 'Other costs', value: (x) => x.otherCosts, type: 'money' }, { header: 'Profit', value: (x) => x.profit, type: 'money' },
    ]
    return sendExcel(res, { fileName: 'brand-order-profit', title: 'Profit per brand order', filters: filters(r), columns, rows: [r.rows], user })
  }
  const r = await clothReport(q)
  type R = (typeof r.rows)[number]
  const columns: Col<R>[] = [
    { header: 'Order', value: (x) => x.docNo, width: 20 }, { header: 'Brand', value: (x) => x.brand, width: 22 }, { header: 'Cloth', value: (x) => x.description, width: 24 },
    { header: 'Unit', value: (x) => x.unit, width: 7 }, { header: 'Received', value: (x) => x.received, type: 'qty' }, { header: 'Used', value: (x) => x.used, type: 'qty' },
    { header: 'Given back', value: (x) => x.returned, type: 'qty' }, { header: 'Left with us', value: (x) => x.left, type: 'qty' },
  ]
  return sendExcel(res, { fileName: 'brand-cloth', title: "Brands' cloth with us", columns, rows: [r.rows], user })
}

export async function exportStatement(res: Response, brandId: number, user: string) {
  const st = await statement(brandId)
  type R = (typeof st.rows)[number]
  const columns: Col<R>[] = [
    { header: 'Date', value: (x) => x.date, type: 'date', width: 13 }, { header: 'Document', value: (x) => x.docNo, width: 20 }, { header: 'Details', value: (x) => x.detail, width: 40 },
    { header: 'Billed', value: (x) => x.billed || null, type: 'money' }, { header: 'Received', value: (x) => x.received || null, type: 'money' }, { header: 'Balance', value: (x) => x.balance, type: 'money' },
  ]
  const opening = { date: null, docNo: '', detail: 'Opening balance', billed: 0, received: 0, balance: st.opening } as unknown as R
  return sendExcel(res, { fileName: `brand-statement-${st.brand.code}`, title: `Brand statement — ${st.brand.name}`, filters: [`Pending: ₹${st.closing.toLocaleString('en-IN')} (+ = they owe us)`], columns, rows: [[opening, ...st.rows]], user })
}

export async function exportBills(res: Response, q: BrandReportQuery, user: string) {
  const rows = await listBills(q)
  type R = (typeof rows)[number]
  const columns: Col<R>[] = [
    { header: 'Bill no.', value: (x) => x.docNo, width: 20 }, { header: 'Date', value: (x) => x.docDate, type: 'date', width: 13 }, { header: 'Brand', value: (x) => x.brandName, width: 24 },
    { header: 'GSTIN', value: (x) => x.brandGstin, width: 17 }, { header: 'Order', value: (x) => x.order.docNo, width: 20 }, { header: 'GST %', value: (x) => Number(x.gstRate), type: 'number', width: 7 },
    { header: 'Taxable', value: (x) => x.taxableTotal, type: 'money' }, { header: 'CGST', value: (x) => x.cgstTotal, type: 'money' }, { header: 'SGST', value: (x) => x.sgstTotal, type: 'money' },
    { header: 'IGST', value: (x) => x.igstTotal, type: 'money' }, { header: 'Total', value: (x) => x.grandTotal, type: 'money' }, { header: 'Still due', value: (x) => x.dueAmount, type: 'money' },
    { header: 'Status', value: (x) => (x.status === 'CANCELLED' ? 'Cancelled' : 'Posted'), width: 10 },
  ]
  return sendExcel(res, { fileName: 'brand-bills', title: 'Brand delivery bills', filters: filters(q), columns, rows: [rows], user })
}

export async function exportPayments(res: Response, q: BrandReportQuery, user: string) {
  const rows = await listPayments(q)
  type R = (typeof rows)[number]
  const columns: Col<R>[] = [
    { header: 'No.', value: (x) => x.docNo, width: 20 }, { header: 'Date', value: (x) => x.docDate, type: 'date', width: 13 }, { header: 'Brand', value: (x) => x.brand.name, width: 24 },
    { header: 'Mode', value: (x) => x.mode, width: 9 }, { header: 'Reference', value: (x) => x.reference, width: 16 }, { header: 'Amount', value: (x) => x.amount, type: 'money' },
    { header: 'Status', value: (x) => (x.status === 'CANCELLED' ? 'Cancelled' : 'Posted'), width: 10 },
  ]
  return sendExcel(res, { fileName: 'brand-payments', title: 'Money received from brands', filters: filters(q), columns, rows: [rows], user })
}
