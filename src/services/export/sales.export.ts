import { byDate } from '../../utils/order'
import type { Response } from 'express'
import { prisma } from '../../config/prisma'
import { filterText, inBatches, sendExcel, type ExcelColumn } from '../../utils/excel'
import type { DocListQuery } from '../../validators/purchase.validator'
import type { CustomerListQuery } from '../../validators/sales.validator'
import * as customerService from '../customer.service'
import { receiptWhere } from '../sales/receipt.service'
import { billRows, type BillFilters, type BillItem } from '../sales/bills.query'

type Filters = Omit<DocListQuery, 'page' | 'pageSize'> & { customerId?: number }
const docFilters = (q: Filters) => filterText([['Status', q.status], ['Search', q.search], ['From', q.from], ['To', q.to]])

export async function exportCustomers(res: Response, q: CustomerListQuery, user: string) {
  const { items } = await customerService.list({ ...q, page: 1, pageSize: Number.MAX_SAFE_INTEGER })
  type Row = (typeof items)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Code', value: (c) => c.code, width: 10 },
    { header: 'Customer', value: (c) => c.name, width: 28 },
    { header: 'Phone', value: (c) => c.phone, width: 15 },
    { header: 'GSTIN', value: (c) => c.gstin, width: 18 },
    { header: 'Opening balance', value: (c) => c.openingBalance, type: 'money' },
    { header: 'Total billed', value: (c) => c.billed, type: 'money' },
    { header: 'Received', value: (c) => c.received, type: 'money' },
    { header: 'Balance (they owe)', value: (c) => c.balance, type: 'money' },
    { header: 'Status', value: (c) => (c.isActive ? 'Active' : 'Inactive'), width: 10 },
  ]
  return sendExcel(res, { fileName: 'customers', title: 'Customers', filters: filterText([['Search', q.search], ['Only with dues', q.withDues ? 'Yes' : undefined]]), columns, rows: [items], user })
}

export async function exportCustomerStatement(res: Response, id: number, user: string) {
  const st = await customerService.statement(id)
  type Row = (typeof st.rows)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Date', value: (r) => r.date, type: 'date', width: 13 },
    { header: 'Document', value: (r) => r.docNo, width: 20 },
    { header: 'Details', value: (r) => r.detail, width: 30 },
    { header: 'Bill / refund', value: (r) => r.debit || null, type: 'money' },
    { header: 'Received / returned', value: (r) => r.credit || null, type: 'money' },
    { header: 'Balance', value: (r) => r.balance, type: 'money' },
  ]
  const opening = { date: null, docNo: '', detail: 'Opening balance', debit: 0, credit: 0, balance: st.opening } as unknown as Row
  return sendExcel(res, { fileName: `statement-${st.customer.code}`, title: `Customer statement — ${st.customer.name}`, filters: [`Closing balance: ₹${st.closing.toLocaleString('en-IN')} (+ = customer owes)`], columns, rows: [[opening, ...st.rows]], user })
}

// Bill-wise sales register with GST split and profit.
// Sales → All bills: shop bills and stitching job bills (filter by kind).
export async function exportSales(res: Response, q: BillFilters, user: string) {
  type Row = BillItem
  const columns: ExcelColumn<Row>[] = [
    { header: 'Type', value: (b) => (b.kind === 'JOB' ? 'Job bill' : 'Sales bill'), width: 11 },
    { header: 'Bill no', value: (b) => b.docNo, width: 20 },
    { header: 'SJ number', value: (b) => b.bookNo, width: 10 },
    { header: 'Date', value: (b) => b.docDate, type: 'date', width: 13 },
    { header: 'Customer', value: (b) => b.customerName, width: 26 },
    { header: 'Phone', value: (b) => b.customerPhone, width: 14 },
    { header: 'Taxable', value: (b) => b.taxable, type: 'money' },
    { header: 'GST', value: (b) => b.gst, type: 'money' },
    { header: 'Stitching', value: (b) => (b.kind === 'JOB' ? b.stitchTotal : null), type: 'money' },
    { header: 'Items sold', value: (b) => b.itemsTotal, type: 'money' },
    { header: 'Bill total', value: (b) => b.grandTotal, type: 'money' },
    { header: 'Received', value: (b) => b.paidAmount, type: 'money' },
    { header: 'Returned', value: (b) => b.returnedAmount, type: 'money' },
    { header: 'Due', value: (b) => (b.status === 'POSTED' ? b.dueAmount : null), type: 'money' },
    { header: 'Status', value: (b) => (b.status === 'POSTED' ? 'Posted' : 'Cancelled'), width: 11 },
  ]
  const filters = [...docFilters(q), ...filterText([['Type', q.kind === 'JOB' ? 'Job bills (stitching)' : q.kind === 'SHOP' ? 'Sales bills (all items sold, incl. on job bills)' : undefined]])]
  return sendExcel(res, { fileName: 'sales-bills', title: 'Sales bills', filters, columns, rows: inBatches((skip, take) => billRows(q, skip, take, q.order === 'oldest' ? 'asc' : 'desc')), user })
}

export async function exportReceipts(res: Response, q: Filters, user: string) {
  const where = receiptWhere(q)
  const fetch = (skip: number, take: number) =>
    prisma.customerReceipt.findMany({ where, orderBy: byDate(q.order), skip, take, include: { customer: { select: { name: true } }, tenders: true } })
  type Row = Awaited<ReturnType<typeof fetch>>[number]
  const by = (r: Row, mode: string) => r.tenders.filter((t) => t.mode === mode).reduce((s, t) => s + Number(t.amount), 0) || null
  const columns: ExcelColumn<Row>[] = [
    { header: 'Receipt no', value: (r) => r.docNo, width: 20 },
    { header: 'Date', value: (r) => r.docDate, type: 'date', width: 13 },
    { header: 'Customer', value: (r) => r.customer?.name ?? 'Cash customer', width: 26 },
    { header: 'Cash', value: (r) => by(r, 'CASH'), type: 'money' },
    { header: 'UPI', value: (r) => by(r, 'UPI'), type: 'money' },
    { header: 'Card', value: (r) => by(r, 'CARD'), type: 'money' },
    { header: 'Bank', value: (r) => by(r, 'BANK'), type: 'money' },
    { header: 'Cheque', value: (r) => by(r, 'CHEQUE'), type: 'money' },
    { header: 'Total', value: (r) => r.amount, type: 'money' },
    { header: 'Status', value: (r) => (r.status === 'POSTED' ? 'Posted' : 'Cancelled'), width: 11 },
    { header: 'Notes', value: (r) => r.notes, width: 26 },
  ]
  return sendExcel(res, { fileName: 'money-received', title: 'Money received', filters: docFilters(q), columns, rows: inBatches(fetch), user })
}
