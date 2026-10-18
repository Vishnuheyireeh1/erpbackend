import ExcelJS from 'exceljs'
import type { Response } from 'express'
import { todayIST } from './financialYear'

// One shared Excel (.xlsx) writer for every "Download Excel" button.
// Streams straight to the browser in batches → 1 lakh+ rows without loading everything in memory.

export type CellType = 'text' | 'number' | 'money' | 'qty' | 'date'

export type ExcelColumn<T> = {
  header: string
  value: (row: T) => unknown
  type?: CellType
  width?: number
}

type Options<T> = {
  fileName: string // "products" → products-2026-10-06.xlsx
  title: string // first row of the sheet
  filters?: string[] // "Status: Active", "From 01-10-2026" … shown under the title
  columns: ExcelColumn<T>[]
  rows: AsyncIterable<T[]> | T[][] // batches
  user: string
}

const FORMATS: Partial<Record<CellType, string>> = {
  money: '#,##0.00',
  qty: '#,##0.###',
  number: '#,##0',
  date: 'dd-mmm-yyyy',
}

export const MAX_EXPORT_ROWS = 300_000

function cell(value: unknown, type: CellType) {
  if (value === null || value === undefined || value === '') return null
  if (type === 'date') return value instanceof Date ? value : new Date(String(value))
  if (type === 'money' || type === 'qty' || type === 'number') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  // Plain string cell (never a formula — exceljs writes strings as text, so "=…" can't execute).
  return String(value)
}

export async function sendExcel<T>(res: Response, opts: Options<T>) {
  const fileName = `${opts.fileName}-${todayIST()}.xlsx`
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
  res.setHeader('Cache-Control', 'no-store')

  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true, useSharedStrings: false })
  wb.creator = 'Sairandhri ERP'
  const sheet = wb.addWorksheet(opts.title.slice(0, 31), { views: [{ state: 'frozen', ySplit: 4 }] })
  sheet.columns = opts.columns.map((c) => ({ width: c.width ?? (c.type && c.type !== 'text' ? 14 : 24) }))

  const title = sheet.addRow([opts.title])
  title.font = { bold: true, size: 14 }
  title.commit()
  const info = [...(opts.filters ?? []), `Downloaded ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} by ${opts.user}`]
  const infoRow = sheet.addRow([info.join('   ·   ')])
  infoRow.font = { color: { argb: 'FF71717A' } }
  infoRow.commit()
  sheet.addRow([]).commit()

  const head = sheet.addRow(opts.columns.map((c) => c.header))
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB5121B' } }
  head.alignment = { vertical: 'middle' }
  head.commit()
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: opts.columns.length } }

  let count = 0
  for await (const batch of opts.rows) {
    for (const row of batch) {
      if (++count > MAX_EXPORT_ROWS) break
      const r = sheet.addRow(opts.columns.map((c) => cell(c.value(row), c.type ?? 'text')))
      opts.columns.forEach((c, i) => {
        const fmt = FORMATS[c.type ?? 'text']
        if (fmt) r.getCell(i + 1).numFmt = fmt
      })
      r.commit()
    }
    if (count > MAX_EXPORT_ROWS) break
  }
  if (count > MAX_EXPORT_ROWS) {
    sheet.addRow([`Stopped at ${MAX_EXPORT_ROWS.toLocaleString('en-IN')} rows — add filters to download the rest.`]).commit()
  }
  sheet.commit()
  await wb.commit()
}

// Fetches a query page by page (for sendExcel's `rows`).
export async function* inBatches<T>(fetchPage: (skip: number, take: number) => Promise<T[]>, size = 5_000) {
  for (let skip = 0; ; skip += size) {
    const rows = await fetchPage(skip, size)
    if (rows.length > 0) yield rows
    if (rows.length < size) return
  }
}

// "Status: Active" style labels for the filter line (skips empty values).
export function filterText(pairs: [string, unknown][]) {
  return pairs.filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 'all').map(([k, v]) => `${k}: ${String(v)}`)
}
