import type ExcelJS from 'exceljs'

// Example rows + the "How to fill" sheet of the product import template — plain shop words for the staff who fill it.
// The rules mirror the checks in import.row.ts / import.validate.ts.

const RED = 'FFB5121B'

// Example rows in the template's column order (name, type, category, unit, selling, purchase, opening stock, GST, size,
// colour) — built from THIS shop's Masters (its types, categories, units, sizes, colours), so every example is a row
// the import accepts. A value the shop doesn't have falls back to the first one in its list.
type Lists = { type?: string[]; category?: string[]; unit?: string[]; gst?: string[]; size?: string[]; colour?: string[] }
const find = (list: string[] | undefined, ...words: RegExp[]) => {
  for (const w of words) {
    const hit = list?.find((x) => w.test(x))
    if (hit) return hit
  }
  return list?.[0] ?? ''
}

export function exampleRows(l: Lists) {
  const gst = find(l.gst, /^5$/)
  const pc = find(l.unit, /^pc$/i, /piece/i)
  const ready = find(l.type, /ready/i)
  const [s1, s2] = [l.size?.[0] ?? '', l.size?.[1] ?? '']
  const colour = find(l.colour, /red/i, /maroon/i, /.*/)
  const kurti = find(l.category, /kurti/i, /ready/i)
  // A kurti in two sizes (2 rows, same name) — or two colours when the shop has no sizes yet.
  const twoWays = s2
    ? [['Cotton printed kurti', ready, kurti, pc, 899, 450, 4, gst, s1, colour], ['Cotton printed kurti', ready, kurti, pc, 899, 450, 6, gst, s2, colour]]
    : l.colour && l.colour.length > 1
      ? [['Cotton printed kurti', ready, kurti, pc, 899, 450, 4, gst, '', l.colour[0]], ['Cotton printed kurti', ready, kurti, pc, 899, 450, 6, gst, '', l.colour[1]]]
      : [['Cotton printed kurti', ready, kurti, pc, 899, 450, 10, gst, '', '']]
  return [
    ['Kanchipuram silk saree', ready, find(l.category, /silk.*saree/i, /saree/i), pc, 4500, 3200, 3, gst, '', colour],
    ...twoWays,
    ['Cotton lining', find(l.type, /raw/i), find(l.category, /lining/i, /fabric/i), find(l.unit, /^m$/i, /metre|meter/i), 120, 80, 25.5, gst, '', ''],
    ['Saree fall', find(l.type, /accessor/i), find(l.category, /accessor/i), pc, 30, 18, 50, gst, '', ''],
  ]
}

const rows = [
  ['Product name *', 'The item\'s name, as you say it in the shop.', 'Anarkali party kurti'],
  ['Type *', 'Pick from the list. Ready-made = bought ready · Own-made = we stitch to sell · Raw material = cloth · Accessory = button, lace, fall, zip · Service = a charge, no stock.', 'Ready-made'],
  ['Category *', 'Pick from the list. "Fabrics > Lining" = the Lining group inside Fabrics.', 'Kurtis'],
  ['Unit *', '', 'pc'],
  ['Selling price *', 'Price we sell at the counter, for 1 piece / 1 metre (GST included).', '1450'],
  ['Purchase price', 'Price we pay the supplier for 1 piece / 1 metre.', '700'],
  ['Opening stock', 'Count how many are in the shop TODAY. Metres can be 42.5. Empty = 0.', '5'],
  ['GST %', 'From the supplier bill: 0, 5 or 18. If not sure, leave empty — the owner fills it later.', '5'],
  ['Size', 'One size per row (only if the item has sizes).', 'M'],
  ['Colour', 'One colour per row (only if needed).', 'Red'],
]

const rules = [
  'RULES',
  '1. Fill the "Products" sheet. Red columns (*) must be filled; grey ones are optional.',
  '   The grey rows starting "Example —" show how to fill — the import skips them (leave or delete them).',
  '2. One row = one item (in one size / one colour). A kurti in M and L = 2 rows with the SAME Product name.',
  '3. Pick Type, Category, Unit, GST %, Size and Colour from the dropdown — don\'t type new words.',
  '4. Only NEW items. An item already in the system is refused — change it in the app instead.',
  '5. Barcode, HSN, MRP … are not needed — the system makes the barcode; the owner adds the rest in the app.',
]

export function addHelpSheet(wb: ExcelJS.Workbook, units: string[]) {
  const s = wb.addWorksheet('How to fill')
  s.columns = [{ header: 'Column', width: 18 }, { header: 'What to write', width: 80 }, { header: 'Example', width: 22 }]
  rows.forEach((r) => s.addRow(r[0] === 'Unit *' ? [r[0], `Pick from the list: ${units.join(' · ')}`, r[2]] : r))
  s.addRow([])
  rules.forEach((line, i) => {
    const row = s.addRow(['', line])
    if (i === 0) row.font = { bold: true, color: { argb: RED } }
  })
  const head = s.getRow(1)
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } }
  s.getColumn(2).alignment = { wrapText: true, vertical: 'top' }
  s.getColumn(1).font = { bold: true }
}
