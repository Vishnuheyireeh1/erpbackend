import { byDate } from '../../utils/order'
import type { Response } from 'express'
import { prisma } from '../../config/prisma'
import { filterText, inBatches, sendExcel, type ExcelColumn } from '../../utils/excel'
import type { DocListQuery } from '../../validators/purchase.validator'
import { directExpenses, jobProfit, tailorWork } from '../reports/workshop.report'
import { statement } from '../workshop/tailor.statement'
import { paymentWhere } from '../workshop/tailorPayment.service'

type Range = { from?: string; to?: string }

export async function exportTailorStatement(res: Response, id: number, user: string) {
  const st = await statement(id)
  type Row = (typeof st.rows)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Date', value: (r) => r.date, type: 'date', width: 13 },
    { header: 'Document', value: (r) => r.docNo, width: 20 },
    { header: 'Details', value: (r) => r.detail, width: 40 },
    { header: 'Pieces', value: (r) => r.pieces || null, type: 'number' },
    { header: 'Earned', value: (r) => r.earned || null, type: 'money' },
    { header: 'Paid', value: (r) => r.paid || null, type: 'money' },
    { header: 'Balance', value: (r) => r.balance, type: 'money' },
  ]
  const opening = { date: null, docNo: '', detail: 'Opening balance', pieces: 0, earned: 0, paid: 0, balance: st.opening } as unknown as Row
  return sendExcel(res, { fileName: `tailor-${st.tailor.code}`, title: `Tailor statement — ${st.tailor.name}`, filters: [`Balance now: ₹${st.closing.toLocaleString('en-IN')} (+ = shop owes)`], columns, rows: [[opening, ...st.rows]], user })
}

export async function exportTailorPayments(res: Response, q: Omit<DocListQuery, 'page' | 'pageSize'> & { tailorId?: number }, user: string) {
  const where = paymentWhere(q)
  const fetch = (skip: number, take: number) => prisma.tailorPayment.findMany({ where, orderBy: byDate(q.order), skip, take, include: { tailor: { select: { name: true } } } })
  type Row = Awaited<ReturnType<typeof fetch>>[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Payment no', value: (p) => p.docNo, width: 20 },
    { header: 'Date', value: (p) => p.docDate, type: 'date', width: 13 },
    { header: 'Tailor', value: (p) => p.tailor.name, width: 24 },
    { header: 'Paid by', value: (p) => p.mode, width: 10 },
    { header: 'Reference', value: (p) => p.reference, width: 16 },
    { header: 'Amount', value: (p) => p.amount, type: 'money' },
    { header: 'Status', value: (p) => (p.status === 'POSTED' ? 'Posted' : 'Cancelled'), width: 11 },
    { header: 'Notes', value: (p) => p.notes, width: 24 },
  ]
  return sendExcel(res, { fileName: 'tailor-payments', title: 'Tailor payments', filters: filterText([['Search', q.search], ['From', q.from], ['To', q.to]]), columns, rows: inBatches(fetch), user })
}

export async function exportTailorWork(res: Response, q: Range, user: string) {
  const r = await tailorWork(q)
  type Row = (typeof r.rows)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Code', value: (t) => t.code, width: 9 },
    { header: 'Tailor', value: (t) => t.name, width: 24 },
    { header: 'Paid', value: (t) => (t.payType === 'PIECE' ? 'Per piece' : 'Salary'), width: 11 },
    { header: 'Jobs', value: (t) => t.jobs, type: 'number' },
    { header: 'Pieces', value: (t) => t.pieces, type: 'number' },
    { header: 'Labour earned', value: (t) => t.labour, type: 'money' },
    { header: 'Paid in period', value: (t) => t.paid, type: 'money' },
    { header: 'Balance now', value: (t) => t.balance, type: 'money' },
  ]
  return sendExcel(res, { fileName: 'tailor-work', title: 'Tailor work', filters: [`${r.from} to ${r.to}`], columns, rows: [r.rows], user })
}

// One row per job, lowest profit first (the by-garment summary is on the screen).
export async function exportJobProfit(res: Response, q: Range, user: string) {
  const r = await jobProfit(q)
  type Row = (typeof r.jobs)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Job', value: (j) => j.docNo, width: 20 },
    { header: 'Date', value: (j) => j.docDate, type: 'date', width: 13 },
    { header: 'Customer', value: (j) => j.customerName, width: 24 },
    { header: 'Stage', value: (j) => (j.status === 'DELIVERED' ? 'Handed over' : j.status === 'READY' ? 'Ready' : 'In work'), width: 12 },
    { header: 'Stitching charged (before GST)', value: (j) => j.charged, type: 'money' },
    { header: 'Tailor pay', value: (j) => j.labour, type: 'money' },
    { header: 'Other work', value: (j) => j.other, type: 'money' },
    { header: 'Cloth given free', value: (j) => j.material, type: 'money' },
    { header: 'Total cost', value: (j) => j.cost, type: 'money' },
    { header: 'Profit', value: (j) => j.profit, type: 'money' },
    { header: 'Margin %', value: (j) => j.marginPct, type: 'number', width: 10 },
  ]
  const t = r.totals
  const filters = [`${r.from} to ${r.to}`, `${t.jobs} jobs · charged ₹${t.charged} (before GST) · cost ₹${t.costTotal} · profit ₹${t.profit} (${t.marginPct}%)`]
  return sendExcel(res, { fileName: 'job-profit', title: 'Profit of each job', filters, columns, rows: [r.jobs], user })
}

export async function exportDirectExpenses(res: Response, q: Range, user: string) {
  const r = await directExpenses(q)
  type Row = (typeof r.rows)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Cost type', value: (x) => x.name, width: 28 },
    { header: 'Salaried (costing only)', value: (x) => x.salaried, type: 'money' },
    { header: 'Paid / payable', value: (x) => x.paid, type: 'money' },
    { header: 'Total', value: (x) => x.total, type: 'money' },
  ]
  return sendExcel(res, { fileName: 'direct-expenses', title: 'Workshop direct expenses', filters: [`${r.from} to ${r.to}`, `Total ₹${r.totals.total}`], columns, rows: [r.rows], user })
}
