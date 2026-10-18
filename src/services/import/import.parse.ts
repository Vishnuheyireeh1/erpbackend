import ExcelJS from 'exceljs'
import { Readable } from 'node:stream'
import { ApiError } from '../../utils/ApiError'
import { MAX_IMPORT_ROWS, headerKey } from './import.columns'

export type RawRow = { rowNo: number; values: Partial<Record<string, string>> }

// Which sheet layout to expect: header text → column key, and one header that must exist.
export type SheetSpec = { headerKey: (header: string) => string | undefined; requiredKey: string; hint: string }

export const productSheet: SheetSpec = { headerKey, requiredKey: 'name', hint: 'Product name, Type …' }

// Cell → trimmed text (numbers, dates, formulas, rich text all handled).
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue) // formula
    if ('richText' in value) return value.richText.map((t) => t.text).join('').trim()
    if ('text' in value) return String(value.text).trim() // hyperlink
    if (value instanceof Date) return value.toISOString().slice(0, 10)
    return ''
  }
  return String(value).trim()
}

function collect(rows: Iterable<{ rowNo: number; cells: string[] }>, spec: SheetSpec) {
  let columns: (string | undefined)[] | null = null
  const out: RawRow[] = []
  for (const { rowNo, cells } of rows) {
    if (!columns) {
      columns = cells.map(spec.headerKey) // first row = headers
      if (!columns.includes(spec.requiredKey)) throw ApiError.badRequest(`First row must be the column headers (${spec.hint})`)
      continue
    }
    if (cells.every((c) => c === '')) continue // skip blank rows
    const values: RawRow['values'] = {}
    cells.forEach((c, i) => {
      const key = columns![i]
      if (key && c !== '') values[key] = c
    })
    out.push({ rowNo, values })
    if (out.length > MAX_IMPORT_ROWS) {
      throw ApiError.badRequest(`Too many rows — split the file (max ${MAX_IMPORT_ROWS.toLocaleString('en-IN')})`)
    }
  }
  if (!columns) throw ApiError.badRequest('The file is empty')
  return out
}

// Streaming read of the FIRST worksheet — low memory even for 1 lakh+ rows.
// Fails on files whose sheet data comes before the workbook index inside the zip
// (some non-Excel tools save that way) → readXlsxFull handles those.
async function readXlsxStreaming(buf: Buffer) {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buf), {
    worksheets: 'emit',
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'ignore',
  })
  const rows: { rowNo: number; cells: string[] }[] = []
  for await (const sheet of reader) {
    for await (const row of sheet) {
      const values = (row.values as ExcelJS.CellValue[]).slice(1) // ExcelJS rows are 1-based
      rows.push({ rowNo: row.number, cells: values.map(cellText) })
      if (rows.length > MAX_IMPORT_ROWS + 1) break
    }
    break // first sheet only (the template's "Lists" sheet is ignored)
  }
  return rows
}

// Whole-file read: works for every .xlsx, uses more memory (~1 GB per 1 lakh rows).
async function readXlsxFull(buf: Buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buf as unknown as ArrayBuffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) return []
  if (sheet.actualRowCount > MAX_IMPORT_ROWS + 1) {
    throw ApiError.badRequest(`Too many rows — split the file (max ${MAX_IMPORT_ROWS.toLocaleString('en-IN')})`)
  }
  const rows: { rowNo: number; cells: string[] }[] = []
  sheet.eachRow({ includeEmpty: false }, (row, rowNo) => {
    rows.push({ rowNo, cells: (row.values as ExcelJS.CellValue[]).slice(1).map(cellText) })
  })
  return rows
}

async function readXlsx(buf: Buffer, spec: SheetSpec) {
  let rows: { rowNo: number; cells: string[] }[]
  try {
    rows = await readXlsxStreaming(buf)
  } catch {
    rows = await readXlsxFull(buf)
  }
  return collect(rows, spec)
}

async function readCsv(buf: Buffer, spec: SheetSpec) {
  const workbook = new ExcelJS.Workbook()
  const sheet = await workbook.csv.read(Readable.from(buf))
  const rows: { rowNo: number; cells: string[] }[] = []
  sheet.eachRow({ includeEmpty: false }, (row, rowNo) => {
    rows.push({ rowNo, cells: (row.values as ExcelJS.CellValue[]).slice(1).map(cellText) })
  })
  return collect(rows, spec)
}

// .xlsx files are ZIPs ("PK" header); anything else is treated as CSV text.
export async function parseSheet(buf: Buffer, fileName: string, spec: SheetSpec = productSheet) {
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b
  if (isZip) {
    try {
      return await readXlsx(buf, spec)
    } catch (err) {
      if (err instanceof ApiError) throw err
      throw ApiError.badRequest("Couldn't read this Excel file. Save it as .xlsx and try again.")
    }
  }
  if (!/\.csv$/i.test(fileName)) throw ApiError.badRequest('Upload an Excel (.xlsx) or CSV file')
  return readCsv(buf, spec)
}
