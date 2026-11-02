import ExcelJS from 'exceljs'
import { prisma } from '../../config/prisma'
import { importColumns, type ColumnKey } from './import.columns'
import { addHelpSheet, exampleRows } from './import.help'

// The product import template staff fill — kept SHORT: 5 must-fill columns + 5 optional ones, each with a dropdown
// where the value comes from Masters (Lists sheet). The import still reads every other column (HSN, MRP, Barcode …)
// if someone adds it — see import.columns.ts.
//   Sheet 1 "Products" (the import reads the FIRST sheet; grey "Example —" rows on top are skipped by it, see
//   EXAMPLE_ROW) · "How to fill" · "Lists" (dropdown values)

const BRAND_RED = 'FFB5121B'
const GREY = 'FF6B7280'
const ROWS = 5000 // dropdowns on this many rows

// Rows whose name starts "Example —" are the template's examples — the import skips them.
export const EXAMPLE_ROW = /^example\s*[—–:-]/i
export const TEMPLATE_KEYS: ColumnKey[] = ['name', 'type', 'category', 'unit', 'sellingPrice', 'purchasePrice', 'openingStock', 'gst', 'size', 'colour']
const WIDTH: Partial<Record<ColumnKey, number>> = { name: 32, type: 16, category: 28, unit: 9, sellingPrice: 14, purchasePrice: 15, openingStock: 15, gst: 9, size: 10, colour: 14 }

type Lists = Partial<Record<ColumnKey, string[]>>

// Dropdown values from Masters. Category = "Main" and "Main > Sub" (the import reads both).
async function loadLists() {
  const [types, categories, units, taxRates, sizes, colours] = await Promise.all([
    prisma.productTypeMaster.findMany({ where: { isActive: true }, orderBy: { id: 'asc' }, select: { name: true } }),
    prisma.category.findMany({ where: { isActive: true }, include: { parent: true } }),
    prisma.unit.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
    prisma.taxRate.findMany({ where: { isActive: true }, orderBy: { rate: 'asc' } }),
    prisma.size.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.colour.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
  ])
  const values: Lists = {
    type: types.map((t) => t.name),
    category: categories.map((c) => (c.parent ? `${c.parent.name} > ${c.name}` : c.name)).sort((a, b) => a.localeCompare(b)),
    unit: units.map((u) => u.code),
    gst: taxRates.map((t) => String(Number(t.rate))),
    size: sizes.map((s) => s.name),
    colour: colours.map((c) => c.name),
  }
  return { values, units: units.map((u) => `${u.code} = ${u.name}`) }
}

// Lists sheet: one column per list → the range each dropdown points at.
function addListsSheet(wb: ExcelJS.Workbook, lists: Lists) {
  const sheet = wb.addWorksheet('Lists')
  const ranges: Partial<Record<ColumnKey, string>> = {}
  Object.entries(lists).forEach(([key, values], i) => {
    const col = i + 1
    const letter = sheet.getColumn(col).letter
    sheet.getColumn(col).width = key === 'category' ? 30 : 16
    sheet.getCell(1, col).value = importColumns.find((c) => c.key === key)!.header
    values!.forEach((v, r) => (sheet.getCell(r + 2, col).value = v))
    if (values!.length) ranges[key as ColumnKey] = `Lists!$${letter}$2:$${letter}$${values!.length + 1}`
  })
  sheet.getRow(1).font = { bold: true }
  return ranges
}

export async function buildTemplate() {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Sairandhri ERP'
  const sheet = wb.addWorksheet('Products', { views: [{ state: 'frozen', ySplit: 1 }] })
  const cols = TEMPLATE_KEYS.map((k) => importColumns.find((c) => c.key === k)!)
  sheet.columns = cols.map((c) => ({ header: c.required ? `${c.header} *` : `${c.header} (optional)`, key: c.key, width: WIDTH[c.key] ?? 14 }))
  const head = sheet.getRow(1)
  head.height = 24
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1)
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.required ? BRAND_RED : GREY } }
    cell.note = c.note
  })

  // Tabs in reading order: Products, How to fill, Lists (the import reads the first one).
  const lists = await loadLists()
  for (const r of exampleRows(lists.values)) {
    const row = sheet.addRow([`Example — ${r[0]}`, ...r.slice(1)])
    row.font = { italic: true, color: { argb: GREY } }
  }
  addHelpSheet(wb, lists.units)
  const ranges = addListsSheet(wb, lists.values)
  // A dropdown on every column whose values come from Masters (typing a value from the list also works).
  cols.forEach((c, i) => {
    const range = ranges[c.key]
    if (!range) return
    for (let r = 2; r <= ROWS; r++) {
      sheet.getCell(r, i + 1).dataValidation = { type: 'list', allowBlank: true, formulae: [range], showErrorMessage: true, errorTitle: c.header, error: 'Pick from the list (Lists sheet).' }
    }
  })
  return Buffer.from(await wb.xlsx.writeBuffer())
}
