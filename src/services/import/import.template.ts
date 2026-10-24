import ExcelJS from 'exceljs'
import { prisma } from '../../config/prisma'
import { importColumns } from './import.columns'
import { addHelpSheet } from './import.help'

const BRAND_RED = 'FFB5121B'
const TYPES = ['Ready-made', 'Own-made', 'Raw material', 'Accessory', 'Service']

const examples = [
  ['Anarkali party kurti', 'Ready-made', 'Kurtis', 'Party wear kurtis', 'pc', 'Sairandhri Originals', 5, 6204, 'Georgette', 'M', 'Red', 700, 1450, 1599, 2, 5, '', '', 'Example — delete these rows'],
  ['Anarkali party kurti', 'Ready-made', 'Kurtis', 'Party wear kurtis', 'pc', 'Sairandhri Originals', 5, 6204, 'Georgette', 'L', 'Red', 700, 1450, 1599, 2, 3, 650, '', 'Old stock bought at 650'],
  ['Pure silk fabric', 'Raw material', 'Fabrics', 'Silk', 'm', '', 5, 5007, 'Silk', '', '', 250, 360, '', 20, 42.5, '', '', 'Sold by the metre'],
]

// Lists sheet: every valid value, so people can copy instead of guessing.
async function addListsSheet(wb: ExcelJS.Workbook) {
  const [categories, units, taxRates, sizes, colours] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, include: { parent: true } }),
    prisma.unit.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
    prisma.taxRate.findMany({ where: { isActive: true }, orderBy: { rate: 'asc' } }),
    prisma.size.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.colour.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
  ])
  // Category + Sub category pairs, one per line (a main category on its own line = no sub category).
  const pairs = categories
    .map((c) => (c.parent ? [c.parent.name, c.name] : [c.name, '']))
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))
  const columns: [string, string[]][] = [
    ['Type', TYPES],
    ['Category', pairs.map((p) => p[0])],
    ['Sub category', pairs.map((p) => p[1])],
    ['Unit', units.map((u) => `${u.code} (${u.name})`)],
    ['GST %', taxRates.map((t) => String(Number(t.rate)))],
    ['Size', sizes.map((s) => s.name)],
    ['Colour', colours.map((c) => c.name)],
  ]
  const sheet = wb.addWorksheet('Lists')
  columns.forEach(([title, values], i) => {
    const col = sheet.getColumn(i + 1)
    col.width = i === 1 || i === 2 ? 24 : 18
    sheet.getCell(1, i + 1).value = title
    values.forEach((v, r) => (sheet.getCell(r + 2, i + 1).value = v))
  })
  sheet.getRow(1).font = { bold: true }
  return TYPES.length
}

// Builds the .xlsx template users fill in.
export async function buildTemplate() {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Sairandhri ERP'
  const sheet = wb.addWorksheet('Products', { views: [{ state: 'frozen', ySplit: 1 }] })

  sheet.columns = importColumns.map((c) => ({ header: c.required ? `${c.header} *` : c.header, key: c.key, width: c.width }))
  const head = sheet.getRow(1)
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_RED } }
  head.height = 22
  importColumns.forEach((c, i) => (head.getCell(i + 1).note = c.note))

  examples.forEach((row) => sheet.addRow(row))

  const typeCount = await addListsSheet(wb)
  addHelpSheet(wb)
  // Dropdown for the Type column on the first 5,000 rows.
  for (let r = 2; r <= 5000; r++) {
    sheet.getCell(r, 2).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`Lists!$A$2:$A$${typeCount + 1}`],
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer())
}
