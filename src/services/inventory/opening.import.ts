import ExcelJS from 'exceljs'
import { prisma } from '../../config/prisma'
import { parseSheet, type SheetSpec } from '../import/import.parse'
import type { RowError } from '../import/import.row'
import { createDocument } from './stockDocument.service'

// Opening stock from Excel: download every item (pre-filled), type the counted qty, upload.
// Rows with an empty qty are skipped, so the same sheet can be filled in parts.

const aliases: Record<string, string> = {
  barcode: 'barcode', sku: 'sku', code: 'barcode',
  openingqty: 'qty', qty: 'qty', quantity: 'qty', countedqty: 'qty',
  unitcost: 'cost', cost: 'cost', costprice: 'cost', purchaseprice: 'cost',
}
const spec: SheetSpec = {
  headerKey: (h) => aliases[h.toLowerCase().replace(/[^a-z]/g, '')],
  requiredKey: 'qty',
  hint: 'Barcode, SKU, Opening qty, Unit cost',
}

const HEADERS = ['Barcode', 'SKU', 'Product', 'Size', 'Colour', 'Unit', 'Current stock', 'Opening qty', 'Unit cost']
const MAX_ERRORS = 500

export async function buildOpeningTemplate() {
  const variants = await prisma.productVariant.findMany({
    where: { isActive: true, product: { isActive: true, type: { not: 'SERVICE' } } },
    orderBy: [{ product: { name: 'asc' } }, { id: 'asc' }],
    select: {
      barcode: true, sku: true, stockQty: true, purchasePrice: true,
      size: { select: { name: true } }, colour: { select: { name: true } },
      product: { select: { name: true, unit: { select: { code: true } } } },
    },
  })
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('Opening stock', { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = HEADERS.map((header, i) => ({ header, width: [16, 22, 34, 8, 12, 7, 13, 13, 11][i] }))
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB5121B' } }
  sheet.getCell('H1').note = 'Type the counted quantity. Leave empty to skip the item.'
  sheet.getCell('I1').note = 'Cost per unit. Pre-filled with the purchase price — change if needed.'
  for (const v of variants) {
    sheet.addRow([
      v.barcode, v.sku, v.product.name, v.size?.name ?? '', v.colour?.name ?? '', v.product.unit.code,
      Number(v.stockQty), null, Number(v.purchasePrice),
    ])
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

type Upload = { buffer: Buffer; originalname: string }

// Reads + checks the sheet. Returns lines ready to post, or errors.
async function plan(file: Upload) {
  const rows = (await parseSheet(file.buffer, file.originalname, spec)).filter((r) => r.values.qty)
  const errors: RowError[] = []
  const barcodes = [...new Set(rows.map((r) => r.values.barcode).filter((b): b is string => !!b))]
  const skus = [...new Set(rows.map((r) => r.values.sku?.toUpperCase()).filter((s): s is string => !!s))]
  const select = { id: true, barcode: true, sku: true, product: { select: { type: true, unit: { select: { allowDecimal: true, code: true } } } } } as const
  const variants = []
  for (let i = 0; i < Math.max(barcodes.length, skus.length); i += 10_000) {
    const b = barcodes.slice(i, i + 10_000)
    const s = skus.slice(i, i + 10_000)
    variants.push(...(await prisma.productVariant.findMany({ where: { OR: [{ barcode: { in: b } }, { sku: { in: s } }] }, select })))
  }
  const byBarcode = new Map(variants.map((v) => [v.barcode, v]))
  const bySku = new Map(variants.map((v) => [v.sku, v]))

  const lines: { variantId: number; qty: number; unitCost?: number }[] = []
  const seen = new Map<number, number>()
  for (const r of rows) {
    const { barcode, sku, qty, cost } = r.values
    const v = (barcode && byBarcode.get(barcode)) || (sku && bySku.get(sku.toUpperCase()))
    const fail = (message: string) => errors.push({ row: r.rowNo, message })
    if (!v) { fail(`No item with barcode "${barcode ?? ''}" / SKU "${sku ?? ''}"`); continue }
    if (v.product.type === 'SERVICE') { fail(`${v.sku} is a service — no stock`); continue }
    const n = Number(qty!.replace(/,/g, ''))
    if (!Number.isFinite(n) || n <= 0) { fail(`Opening qty "${qty}" must be a number above 0`); continue }
    if (!v.product.unit.allowDecimal && !Number.isInteger(n)) { fail(`${v.sku} is counted in whole ${v.product.unit.code} — ${n} isn't allowed`); continue }
    const c = cost ? Number(cost.replace(/[₹,]/g, '')) : undefined
    if (c !== undefined && (!Number.isFinite(c) || c < 0)) { fail(`Unit cost "${cost}" is not valid`); continue }
    const prev = seen.get(v.id)
    if (prev) { fail(`${v.sku} is already on row ${prev}`); continue }
    seen.set(v.id, r.rowNo)
    lines.push({ variantId: v.id, qty: n, unitCost: c })
  }
  const value = lines.reduce((s, l) => s + l.qty * (l.unitCost ?? 0), 0)
  return { lines, errors: errors.slice(0, MAX_ERRORS), errorCount: errors.length, value }
}

export async function checkOpeningFile(file: Upload | undefined) {
  if (!file) return { lines: 0, errors: [{ row: 0, message: 'Choose a file to upload' }], errorCount: 1, value: 0 }
  const p = await plan(file)
  return { lines: p.lines.length, errors: p.errors, errorCount: p.errorCount, value: p.value }
}

// Re-checks, then posts ONE opening-stock document (whole-number / service rules enforced by the engine).
export async function importOpeningFile(file: Upload | undefined, docDate: string | undefined, user: string) {
  if (!file) return { imported: false as const, errors: [{ row: 0, message: 'Choose a file to upload' }], errorCount: 1 }
  const p = await plan(file)
  if (p.errorCount > 0 || p.lines.length === 0) {
    const errors = p.lines.length === 0 && p.errorCount === 0 ? [{ row: 0, message: 'No rows with an opening qty' }] : p.errors
    return { imported: false as const, errors, errorCount: Math.max(p.errorCount, errors.length) }
  }
  const id = await createDocument({ kind: 'OPENING', reason: 'OPENING', docDate, note: `Imported from ${file.originalname}`, lines: p.lines }, user)
  const doc = await prisma.stockDocument.findUniqueOrThrow({ where: { id }, select: { id: true, docNo: true, totalValue: true } })
  return { imported: true as const, document: doc, lines: p.lines.length }
}
