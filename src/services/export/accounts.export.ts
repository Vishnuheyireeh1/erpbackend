import type { Response } from 'express'
import { sendExcel, type ExcelColumn } from '../../utils/excel'
import type { JournalListQuery, LedgerQuery, Period } from '../../validators/accounts.validator'
import { balanceSheet, profitLoss, trialBalance } from '../accounts/books.service'
import { KIND_LABEL, loadChart } from '../accounts/chart'
import { listJournals } from '../accounts/journal.service'
import { ledger, salesByType } from '../accounts/ledger.service'

// Excel for the Accounts page — the files a CA asks for.
const dr = (v: number) => (v > 0 ? v : null)
const cr = (v: number) => (v < 0 ? -v : null)

export async function exportTrialBalance(res: Response, q: Period, user: string) {
  const r = await trialBalance(q)
  type Row = (typeof r.lines)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Code', value: (l) => l.code, width: 10 },
    { header: 'Account', value: (l) => l.name, width: 36 },
    { header: 'Group', value: (l) => KIND_LABEL[l.kind], width: 28 },
    { header: 'Opening Dr', value: (l) => dr(l.opening), type: 'money' },
    { header: 'Opening Cr', value: (l) => cr(l.opening), type: 'money' },
    { header: 'Debit', value: (l) => l.debit || null, type: 'money' },
    { header: 'Credit', value: (l) => l.credit || null, type: 'money' },
    { header: 'Closing Dr', value: (l) => dr(l.closing), type: 'money' },
    { header: 'Closing Cr', value: (l) => cr(l.closing), type: 'money' },
  ]
  const t = r.totals
  const filters = [`${r.from} to ${r.to}`, `Totals — debit ₹${t.debit}, credit ₹${t.credit}; closing Dr ₹${t.closingDr} = Cr ₹${t.closingCr}${r.balanced ? ' ✓' : ' — NOT balanced'}`]
  return sendExcel(res, { fileName: 'trial-balance', title: 'Trial balance', filters, columns, rows: [r.lines], user })
}

type Line = { section: string; name: string; amount: number | null }
const lineColumns: ExcelColumn<Line>[] = [
  { header: 'Section', value: (l) => l.section, width: 30 },
  { header: 'Account', value: (l) => l.name, width: 40 },
  { header: 'Amount', value: (l) => l.amount, type: 'money' },
]

export async function exportProfitLoss(res: Response, q: Period, user: string) {
  const r = await profitLoss(q)
  const rows: Line[] = [
    ...r.income.map((l) => ({ section: 'Income', name: l.name, amount: l.amount })), { section: 'Income', name: 'Total income', amount: r.incomeTotal },
    ...r.direct.map((l) => ({ section: 'Direct costs', name: l.name, amount: l.amount })), { section: 'Direct costs', name: 'Total direct costs', amount: r.directTotal },
    { section: 'Gross profit', name: 'Income − direct costs', amount: r.grossProfit },
    ...r.indirect.map((l) => ({ section: 'Shop expenses', name: l.name, amount: l.amount })), { section: 'Shop expenses', name: 'Total shop expenses', amount: r.indirectTotal },
    { section: 'Net profit', name: 'Gross profit − shop expenses', amount: r.netProfit },
  ]
  return sendExcel(res, { fileName: 'profit-and-loss', title: 'Profit & loss (books)', filters: [`${r.from} to ${r.to}`, 'Amounts before GST'], columns: lineColumns, rows: [rows], user })
}

export async function exportBalanceSheet(res: Response, q: Period, user: string) {
  const r = await balanceSheet(q)
  const rows: Line[] = [
    ...r.assets.map((l) => ({ section: 'What the shop owns (assets)', name: l.name, amount: l.amount })), { section: 'Assets', name: 'Total assets', amount: r.assetsTotal },
    ...r.liabilities.map((l) => ({ section: 'What the shop owes (liabilities)', name: l.name, amount: l.amount })), { section: 'Liabilities', name: 'Total liabilities', amount: r.liabilitiesTotal },
    ...r.equity.map((l) => ({ section: 'Net worth (capital & profit)', name: l.name, amount: l.amount })), { section: 'Net worth (capital & profit)', name: 'Total net worth', amount: r.equityTotal },
  ]
  return sendExcel(res, { fileName: 'balance-sheet', title: 'Balance sheet', filters: [`As on ${r.to}`, r.balanced ? 'Assets = liabilities + capital ✓' : 'NOT balanced'], columns: lineColumns, rows: [rows], user })
}

export async function exportLedger(res: Response, code: string, q: LedgerQuery, user: string) {
  const r = await ledger(code, q, 300_000)
  type Row = (typeof r.lines)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Date', value: (l) => l.date, type: 'date', width: 13 },
    { header: 'Document', value: (l) => l.docNo, width: 20 },
    { header: 'Party', value: (l) => l.party, width: 28 },
    { header: 'Details', value: (l) => l.memo, width: 32 },
    { header: 'Debit', value: (l) => l.debit || null, type: 'money' },
    { header: 'Credit', value: (l) => l.credit || null, type: 'money' },
    { header: 'Balance (+ Dr / − Cr)', value: (l) => l.balance, type: 'money' },
  ]
  const filters = [`${r.account.code} ${r.account.name}${r.party ? ` · ${r.party.name}` : ''}`, `${r.from} to ${r.to}`, `Opening ₹${r.opening} · closing ₹${r.closing}`]
  return sendExcel(res, { fileName: `ledger-${code}`, title: `Ledger — ${r.account.name}`, filters, columns, rows: [r.lines], user })
}

export async function exportChart(res: Response, user: string) {
  const rows = await loadChart()
  type Row = (typeof rows)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Code', value: (a) => a.code, width: 10 },
    { header: 'Account', value: (a) => a.name, width: 36 },
    { header: 'Group', value: (a) => KIND_LABEL[a.kind], width: 30 },
    { header: 'What it holds', value: (a) => a.hint, width: 60 },
    { header: 'Status', value: (a) => (a.isActive ? 'Active' : 'Inactive'), width: 10 },
  ]
  return sendExcel(res, { fileName: 'chart-of-accounts', title: 'Chart of accounts', columns, rows: [rows], user })
}

export async function exportJournals(res: Response, q: JournalListQuery, user: string) {
  const r = await listJournals({ ...q, page: 1, pageSize: 100_000 })
  type Row = (typeof r.items)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Entry', value: (e) => e.docNo, width: 20 },
    { header: 'Date', value: (e) => e.docDate, type: 'date', width: 13 },
    { header: 'Narration', value: (e) => e.narration, width: 50 },
    { header: 'Amount', value: (e) => e.total, type: 'money' },
    { header: 'Status', value: (e) => (e.status === 'POSTED' ? 'Posted' : `Cancelled — ${e.cancelReason ?? ''}`), width: 24 },
  ]
  return sendExcel(res, { fileName: 'journal-entries', title: 'Journal entries', columns, rows: [r.items], user })
}

export async function exportSalesByType(res: Response, q: Period & { by: 'day' | 'month' }, user: string) {
  const r = await salesByType(q)
  type Row = (typeof r.lines)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: q.by === 'month' ? 'Month' : 'Date', value: (l) => l.period, type: 'date', width: 13 },
    { header: 'Shop sales', value: (l) => l.shop, type: 'money' },
    { header: 'Stitching jobs', value: (l) => l.stitching, type: 'money' },
    { header: 'Training fees', value: (l) => l.fees, type: 'money' },
    { header: 'Total', value: (l) => l.total, type: 'money' },
  ]
  const t = r.totals
  const filters = [`${r.from} to ${r.to}`, `Before GST · shop ₹${t.shop} · stitching ₹${t.stitching} · fees ₹${t.fees} · total ₹${t.total}`]
  return sendExcel(res, { fileName: 'sales-by-type', title: 'Sales by type', filters, columns, rows: [r.lines], user })
}
