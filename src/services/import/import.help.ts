import type ExcelJS from 'exceljs'

// "How to fill" sheet of the product import template — plain shop words for the staff who fill it.
// The "Must it be different?" column mirrors the checks in import.validate.ts.

const rows = [
  ['Product name *', 'The item\'s name, as you say it in the shop.', 'Anarkali party kurti', 'Yes — a new item. The same name can repeat ONLY for its other sizes / colours.'],
  ['Type *', 'Pick from the list: Ready-made = bought ready · Own-made = we stitch to sell · Raw material = cloth · Accessory = button, lace, zip · Service = stitching charge.', 'Ready-made', 'No — but all rows of one item must have the same Type.'],
  ['Category *', 'The big group (look in the Lists sheet).', 'Kurtis', 'No'],
  ['Sub category', 'The small group inside it (look in the Lists sheet). Can be empty.', 'Party wear kurtis', 'No'],
  ['Unit *', 'pc = counted in pieces · m = measured in metres.', 'pc', 'No — but all rows of one item must have the same Unit.'],
  ['GST %', 'Tax % on the supplier bill (0, 5 or 18).', '5', 'No'],
  ['HSN code', 'Tax code number on the supplier bill.', '6204', 'No'],
  ['Fabric', 'Cloth type.', 'Georgette', 'No'],
  ['Size', 'One size in one row.', 'M', 'Yes — inside one item, every row needs a different Size or Colour.'],
  ['Colour', 'One colour in one row.', 'Red', 'Yes — same as Size.'],
  ['Purchase price', 'Rate we pay the supplier for 1 piece / 1 metre.', '700', 'No'],
  ['Selling price *', 'Rate we sell at the counter (tax included).', '1450', 'No'],
  ['MRP', 'MRP printed on the tag. Empty if none.', '1599', 'No'],
  ['Low-stock alert', 'When only this many are left, the system reminds us to buy more.', '2', 'No'],
  ['Opening stock', 'Count how many are in the shop today and write it. Empty = 0.', '5', 'No'],
  ['Stock cost', 'Only if today\'s stock was bought at a different rate. Else leave empty.', '650', 'No'],
  ['Barcode', 'Leave EMPTY — the system makes it. Fill only if the tag already has a printed barcode.', '', 'Yes — no two items can have the same barcode.'],
  ['Notes', 'Anything extra to remember.', 'Sold by the metre', 'No'],
]

const rules = [
  'RULES',
  '1. One row = one size + one colour of an item. A kurti in S, M, L = 3 rows with the same Product name.',
  '2. Product name + Category + Sub category together make ONE item. If that item is already in the system, the row is refused — change it in the app instead.',
  '3. Rows of the same item: Size / Colour must be different; Type and Unit must be the same.',
  '4. Barcode (if you fill it) must never repeat — not in this file, not in the system.',
  '5. Everything else (price, category, fabric …) can repeat on any number of rows.',
  '6. Delete the 3 example rows on the Products sheet before you start. * = must fill.',
]

export function addHelpSheet(wb: ExcelJS.Workbook) {
  const s = wb.addWorksheet('How to fill')
  s.columns = [
    { header: 'Column', width: 17 },
    { header: 'What to write', width: 70 },
    { header: 'Example', width: 20 },
    { header: 'Must it be different on every row?', width: 50 },
  ]
  rows.forEach((r) => s.addRow(r))
  s.addRow([])
  rules.forEach((line, i) => {
    const row = s.addRow(['', line])
    if (i === 0) row.font = { bold: true, color: { argb: 'FFB5121B' } }
  })
  const head = s.getRow(1)
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB5121B' } }
  for (const c of [2, 4]) s.getColumn(c).alignment = { wrapText: true, vertical: 'top' }
  s.getColumn(1).font = { bold: true }
  // "Yes" rows stand out so staff notice them.
  s.eachRow((row, n) => {
    if (n > 1 && String(row.getCell(4).value ?? '').startsWith('Yes')) row.getCell(4).font = { bold: true, color: { argb: 'FFB5121B' } }
  })
}
