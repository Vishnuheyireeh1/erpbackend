import { byDate } from '../../utils/order'
import type { Response } from 'express'
import { prisma } from '../../config/prisma'
import { filterText, inBatches, sendExcel, type ExcelColumn } from '../../utils/excel'
import type { DocListQuery } from '../../validators/purchase.validator'
import type { SupplierListQuery } from '../../validators/supplier.validator'
import { paymentWhere } from '../purchase/payment.service'
import { dueOf, purchaseWhere } from '../purchase/purchase.query'
import * as supplierService from '../supplier.service'

type Filters = Omit<DocListQuery, 'page' | 'pageSize'>
const docFilters = (q: Filters) => filterText([['Status', q.status], ['Search', q.search], ['From', q.from], ['To', q.to]])

export async function exportSuppliers(res: Response, q: SupplierListQuery, user: string) {
  const { items } = await supplierService.list({ ...q, page: 1, pageSize: Number.MAX_SAFE_INTEGER })
  type Row = (typeof items)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Code', value: (s) => s.code, width: 10 },
    { header: 'Supplier', value: (s) => s.name, width: 30 },
    { header: 'Contact person', value: (s) => s.contactPerson, width: 18 },
    { header: 'Phone', value: (s) => s.phone, width: 15 },
    { header: 'Email', value: (s) => s.email, width: 24 },
    { header: 'GSTIN', value: (s) => s.gstin, width: 18 },
    { header: 'State', value: (s) => s.stateName, width: 16 },
    { header: 'City', value: (s) => s.city, width: 14 },
    { header: 'Opening balance', value: (s) => s.openingBalance, type: 'money' },
    { header: 'Total billed', value: (s) => s.billed, type: 'money' },
    { header: 'Total paid', value: (s) => s.paid, type: 'money' },
    { header: 'Balance (to pay)', value: (s) => s.balance, type: 'money' },
    { header: 'Status', value: (s) => (s.isActive ? 'Active' : 'Inactive'), width: 10 },
  ]
  return sendExcel(res, { fileName: 'suppliers', title: 'Suppliers', filters: filterText([['Search', q.search], ['Status', q.status], ['Only with dues', q.withDues ? 'Yes' : undefined]]), columns, rows: [items], user })
}

export async function exportStatement(res: Response, id: number, user: string) {
  const st = await supplierService.statement(id)
  type Row = (typeof st.rows)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Date', value: (r) => r.date, type: 'date', width: 13 },
    { header: 'Document', value: (r) => r.docNo, width: 20 },
    { header: 'Details', value: (r) => r.detail, width: 36 },
    { header: 'Bill amount', value: (r) => r.credit || null, type: 'money' },
    { header: 'Paid / returned', value: (r) => r.debit || null, type: 'money' },
    { header: 'Balance', value: (r) => r.balance, type: 'money' },
  ]
  const opening = { date: null, docNo: '', detail: 'Opening balance', credit: 0, debit: 0, balance: st.opening } as unknown as Row
  return sendExcel(res, {
    fileName: `statement-${st.supplier.code}`,
    title: `Supplier statement — ${st.supplier.name}`,
    filters: [`Closing balance: ₹${st.closing.toLocaleString('en-IN')} (+ = you owe them)`],
    columns,
    rows: [[opening, ...st.rows]],
    user,
  })
}

// Bill-wise GST columns → usable directly for the accountant's purchase register.
export async function exportPurchases(res: Response, q: Filters, user: string) {
  const where = await purchaseWhere(q)
  const fetch = (skip: number, take: number) =>
    prisma.purchaseInvoice.findMany({ where, orderBy: byDate(q.order), skip, take, include: { supplier: { select: { name: true, gstin: true } } } })
  type Row = Awaited<ReturnType<typeof fetch>>[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Bill no', value: (b) => b.docNo, width: 20 },
    { header: 'Received', value: (b) => b.docDate, type: 'date', width: 13 },
    { header: 'Supplier', value: (b) => b.supplier.name, width: 28 },
    { header: 'Supplier GSTIN', value: (b) => b.supplier.gstin, width: 18 },
    { header: 'Supplier bill no', value: (b) => b.supplierInvoiceNo, width: 16 },
    { header: 'Supplier bill date', value: (b) => b.supplierInvoiceDate, type: 'date', width: 15 },
    { header: 'GST type', value: (b) => (b.taxMode === 'INTRA' ? 'CGST+SGST' : 'IGST'), width: 11 },
    { header: 'Bill discount', value: (b) => Number(b.billDiscount) || null, type: 'money' },
    { header: 'Taxable', value: (b) => b.taxableTotal, type: 'money' },
    { header: 'CGST', value: (b) => b.cgstTotal, type: 'money' },
    { header: 'SGST', value: (b) => b.sgstTotal, type: 'money' },
    { header: 'IGST', value: (b) => b.igstTotal, type: 'money' },
    { header: 'Other charges', value: (b) => b.otherCharges, type: 'money' },
    { header: 'GST on charges', value: (b) => Number(b.chargesTax) || null, type: 'money' },
    { header: 'Freight paid separately', value: (b) => Number(b.freightSeparate) || null, type: 'money' },
    { header: 'Round off', value: (b) => b.roundOff, type: 'money' },
    { header: 'Total', value: (b) => b.grandTotal, type: 'money' },
    { header: 'Paid', value: (b) => b.paidAmount, type: 'money' },
    { header: 'Returned', value: (b) => b.returnedAmount, type: 'money' },
    { header: 'Due', value: (b) => (b.status === 'POSTED' ? dueOf(b) : null), type: 'money' },
    { header: 'Status', value: (b) => (b.status === 'POSTED' ? 'Posted' : 'Cancelled'), width: 11 },
  ]
  return sendExcel(res, { fileName: 'purchase-bills', title: 'Purchase bills', filters: docFilters(q), columns, rows: inBatches(fetch), user })
}

export async function exportPayments(res: Response, q: Filters, user: string) {
  const where = paymentWhere(q)
  const fetch = (skip: number, take: number) =>
    prisma.supplierPayment.findMany({ where, orderBy: byDate(q.order), skip, take, include: { supplier: { select: { name: true } } } })
  type Row = Awaited<ReturnType<typeof fetch>>[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Payment no', value: (p) => p.docNo, width: 20 },
    { header: 'Date', value: (p) => p.docDate, type: 'date', width: 13 },
    { header: 'Supplier', value: (p) => p.supplier.name, width: 28 },
    { header: 'Paid by', value: (p) => p.mode, width: 10 },
    { header: 'Reference', value: (p) => p.reference, width: 18 },
    { header: 'Amount', value: (p) => p.amount, type: 'money' },
    { header: 'Status', value: (p) => (p.status === 'POSTED' ? 'Posted' : 'Cancelled'), width: 11 },
    { header: 'Notes', value: (p) => p.notes, width: 30 },
  ]
  return sendExcel(res, { fileName: 'supplier-payments', title: 'Supplier payments', filters: docFilters(q), columns, rows: inBatches(fetch), user })
}
