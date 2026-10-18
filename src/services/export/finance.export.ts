import { byDate } from '../../utils/order'
import type { Response } from 'express'
import { prisma } from '../../config/prisma'
import { filterText, inBatches, sendExcel, type ExcelColumn } from '../../utils/excel'
import type { FinanceListQuery } from '../../validators/finance.validator'
import { dayBook } from '../finance/daybook.service'
import { expenseWhere } from '../finance/expense.service'
import { movementWhere, moveLabels } from '../finance/money.service'
import { profitAndLoss } from '../finance/profit.service'
import { costRows, type CostKind } from '../finance/costs.service'

type Filters = Omit<FinanceListQuery, 'page' | 'pageSize'>
const filters = (q: Filters) => filterText([['Status', q.status], ['Kind', q.expenseKind === 'DIRECT' ? 'Direct (stitching / making)' : q.expenseKind === 'INDIRECT' ? 'Indirect (shop running)' : undefined], ['Search', q.search], ['From', q.from], ['To', q.to]])

export const dayBookKinds: Record<string, string> = {
  RECEIPT: 'Money received', REFUND: 'Refund to customer', SUPPLIER_PAYMENT: 'Paid to supplier', TAILOR_PAYMENT: 'Paid to tailor',
  JOB_COST: 'Job cost paid', SALARY: 'Salary paid', FEE: 'Training fee received', PRODUCTION_COST: 'Production cost paid', EXPENSE: 'Expense',
  FREIGHT: 'Freight paid (lorry)', JOURNAL: 'Journal entry (accounts)', ASSET_BOUGHT: 'Asset bought (AC, machine …)', ...moveLabels,
}

export async function exportExpenses(res: Response, q: Filters, user: string) {
  const where = expenseWhere(q)
  const fetch = (skip: number, take: number) => prisma.expense.findMany({ where, orderBy: byDate(q.order), skip, take, include: { category: { select: { name: true, kind: true } } } })
  type Row = Awaited<ReturnType<typeof fetch>>[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Expense no', value: (e) => e.docNo, width: 20 },
    { header: 'Date', value: (e) => e.docDate, type: 'date', width: 13 },
    { header: 'Type', value: (e) => e.category.name, width: 22 },
    { header: 'Direct / indirect', value: (e) => (e.category.kind === 'ASSET' ? 'Asset' : e.category.kind === 'DIRECT' ? 'Direct' : 'Indirect'), width: 14 },
    { header: 'Paid to', value: (e) => e.paidTo, width: 22 },
    { header: 'Paid by', value: (e) => e.mode, width: 10 },
    { header: 'Reference', value: (e) => e.reference, width: 16 },
    { header: 'Amount', value: (e) => e.amount, type: 'money' },
    { header: 'Status', value: (e) => (e.status === 'POSTED' ? 'Posted' : 'Cancelled'), width: 11 },
    { header: 'Notes', value: (e) => e.notes, width: 26 },
  ]
  return sendExcel(res, { fileName: 'expenses', title: 'Expenses', filters: filters(q), columns, rows: inBatches(fetch), user })
}

export async function exportMovements(res: Response, q: Filters, user: string) {
  const where = movementWhere(q)
  const fetch = (skip: number, take: number) => prisma.moneyMovement.findMany({ where, orderBy: byDate(q.order), skip, take })
  type Row = Awaited<ReturnType<typeof fetch>>[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Entry no', value: (m) => m.docNo, width: 20 },
    { header: 'Date', value: (m) => m.docDate, type: 'date', width: 13 },
    { header: 'What', value: (m) => moveLabels[m.kind], width: 26 },
    { header: 'Mode', value: (m) => m.mode, width: 10 },
    { header: 'Amount', value: (m) => m.amount, type: 'money' },
    { header: 'Reference', value: (m) => m.reference, width: 16 },
    { header: 'Status', value: (m) => (m.status === 'POSTED' ? 'Posted' : 'Cancelled'), width: 11 },
    { header: 'Notes', value: (m) => m.notes, width: 26 },
  ]
  return sendExcel(res, { fileName: 'cash-bank-movements', title: 'Cash / bank movements', filters: filters(q), columns, rows: inBatches(fetch), user })
}

export async function exportDayBook(res: Response, q: { from?: string; to?: string }, user: string) {
  const b = await dayBook(q)
  type Row = (typeof b.rows)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Date', value: (r) => r.date, type: 'date', width: 13 },
    { header: 'Document', value: (r) => r.docNo, width: 20 },
    { header: 'What', value: (r) => dayBookKinds[r.kind] ?? r.kind, width: 22 },
    { header: 'Party', value: (r) => r.party, width: 24 },
    { header: 'Mode', value: (r) => r.mode, width: 9 },
    { header: 'Account', value: (r) => (r.account === 'CASH' ? 'Cash' : 'Bank'), width: 9 },
    { header: 'In', value: (r) => r.in || null, type: 'money' },
    { header: 'Out', value: (r) => r.out || null, type: 'money' },
  ]
  const t = b.totals
  const lines = [`${b.from} to ${b.to}`, `Cash: opening ₹${t.cash.opening} + in ₹${t.cash.in} − out ₹${t.cash.out} = closing ₹${t.cash.closing}`, `Bank: opening ₹${t.bank.opening} + in ₹${t.bank.in} − out ₹${t.bank.out} = closing ₹${t.bank.closing}`]
  return sendExcel(res, { fileName: 'day-book', title: 'Day book', filters: lines, columns, rows: [b.rows], user })
}

export async function exportProfit(res: Response, q: { from?: string; to?: string }, user: string) {
  const p = await profitAndLoss(q)
  type Row = { section: string; name: string; amount: number }
  const rows: Row[] = [
    { section: 'Income', name: 'Goods sold (counter + items on jobs − returns)', amount: p.income.goodsSold },
    { section: 'Income', name: 'Stitching charges', amount: p.income.stitching },
    { section: 'Income', name: 'Training fees', amount: p.income.training },
    { section: 'Income', name: 'Other income', amount: p.income.otherIncome },
    { section: 'Income', name: 'TOTAL INCOME', amount: p.income.total },
    { section: 'Cost of goods', name: 'Stock cost of goods sold', amount: p.costOfGoods },
    ...p.direct.map((d) => ({ section: 'Direct costs', name: d.name, amount: d.amount })),
    { section: '', name: 'GROSS PROFIT', amount: p.grossProfit },
    ...p.indirect.map((d) => ({ section: 'Shop expenses', name: d.name, amount: d.amount })),
    { section: '', name: 'NET PROFIT', amount: p.netProfit },
  ]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Section', value: (r) => r.section, width: 16 },
    { header: 'Item', value: (r) => r.name, width: 48 },
    { header: 'Amount', value: (r) => r.amount, type: 'money' },
  ]
  return sendExcel(res, { fileName: 'profit-and-loss', title: 'Profit & loss', filters: [`${p.from} to ${p.to}`, 'Before GST. Salary is counted in the month it is for.'], columns, rows: [rows], user })
}

// Expenses page → every cost of the period (typed + automatic), Direct / Indirect.
export async function exportCosts(res: Response, q: { from?: string; to?: string; kind?: CostKind; search?: string; order?: 'newest' | 'oldest' }, user: string) {
  const r = await costRows(q)
  type Row = (typeof r.rows)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Date', value: (x) => x.date, type: 'date', width: 13 },
    { header: 'Cost', value: (x) => x.what, width: 30 },
    { header: 'Details', value: (x) => x.detail, width: 40 },
    { header: 'Kind', value: (x) => (x.kind === 'ASSET' ? 'Asset (owned)' : x.kind === 'DIRECT' ? 'Direct' : 'Indirect'), width: 13 },
    { header: 'Document', value: (x) => x.docNo, width: 20 },
    { header: 'Paid by', value: (x) => x.mode, width: 10 },
    { header: 'Amount', value: (x) => (x.cancelled ? null : x.amount), type: 'money' },
    { header: 'Status', value: (x) => (x.cancelled ? 'Cancelled' : ''), width: 11 },
  ]
  const filters = [`${r.from} to ${r.to}`, `Expenses ₹${r.totals.all} (direct ₹${r.totals.direct} · indirect ₹${r.totals.indirect}) · assets bought ₹${r.totals.assets}`, ...filterText([['Kind', q.kind], ['Search', q.search]])]
  return sendExcel(res, { fileName: 'expenses-all', title: 'All expenses', filters, columns, rows: [r.rows], user })
}
