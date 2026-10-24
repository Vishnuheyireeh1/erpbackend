import { existingBarcodes, existingProductKeys, loadLookups, norm } from './import.lookups'
import type { RawRow } from './import.parse'
import { parseRow, type ParsedRow, type RowError } from './import.row'

export type PlannedProduct = { first: ParsedRow; variants: ParsedRow[] }

export type ImportPlan = {
  rowCount: number
  products: PlannedProduct[]
  toCreate: { sizes: string[]; colours: string[] }
  errors: RowError[]
  errorCount: number
}

const MAX_ERRORS_RETURNED = 500

// Unique new master names (first spelling wins).
function newNames(rows: ParsedRow[], pick: (r: ParsedRow) => ParsedRow['size']) {
  const names = new Map<string, string>()
  for (const r of rows) {
    const ref = pick(r)
    if (ref && ref.id === undefined && !names.has(norm(ref.name))) names.set(norm(ref.name), ref.name)
  }
  return [...names.values()]
}

// Full check of a parsed sheet. Nothing is saved here.
export async function buildPlan(rawRows: RawRow[], createMissing: boolean): Promise<ImportPlan> {
  const lookups = await loadLookups()
  const errors: RowError[] = []
  const rows: ParsedRow[] = []
  for (const raw of rawRows) {
    const result = parseRow(raw, lookups, createMissing)
    errors.push(...result.errors)
    if (result.row) rows.push(result.row)
  }

  // Group rows → products (same name + category).
  const groups = new Map<string, PlannedProduct>()
  for (const r of rows) {
    const key = `${norm(r.name)}|${r.categoryId}`
    const group = groups.get(key)
    if (!group) groups.set(key, { first: r, variants: [r] })
    else {
      if (group.first.type !== r.type || group.first.unitId !== r.unitId) {
        errors.push({ row: r.rowNo, message: `Type / unit differs from row ${group.first.rowNo} of the same product` })
      }
      group.variants.push(r)
    }
  }

  // Variants inside one product: need size or colour, and no repeated combination.
  for (const g of groups.values()) {
    const seen = new Map<string, number>()
    for (const v of g.variants) {
      if (g.variants.length > 1 && !v.size && !v.colour) {
        errors.push({ row: v.rowNo, message: `"${v.name}" has several rows — each needs a size or colour` })
      }
      const combo = `${norm(v.size?.name ?? '')}|${norm(v.colour?.name ?? '')}`
      const prev = seen.get(combo)
      if (prev) errors.push({ row: v.rowNo, message: `Same size and colour as row ${prev}` })
      else seen.set(combo, v.rowNo)
    }
  }

  // Already in the database?
  const existing = await existingProductKeys([...new Set(rows.map((r) => r.name))])
  for (const [key, g] of groups) {
    const code = existing.get(key)
    if (code) errors.push({ row: g.first.rowNo, message: `"${g.first.name}" already exists (${code}) — edit it in the app instead` })
  }

  // Barcodes: unique in the file and not used in the database.
  const fileBarcodes = new Map<string, number>()
  for (const r of rows) {
    if (!r.barcode) continue
    const prev = fileBarcodes.get(r.barcode)
    if (prev) errors.push({ row: r.rowNo, column: 'Barcode', message: `Same barcode as row ${prev}` })
    else fileBarcodes.set(r.barcode, r.rowNo)
  }
  const used = await existingBarcodes([...fileBarcodes.keys()])
  for (const [code, rowNo] of fileBarcodes) {
    if (used.has(code)) errors.push({ row: rowNo, column: 'Barcode', message: `Barcode ${code} is already used by another product` })
  }

  errors.sort((a, b) => a.row - b.row)
  return {
    rowCount: rawRows.length,
    products: [...groups.values()],
    toCreate: {
      sizes: newNames(rows, (r) => r.size),
      colours: newNames(rows, (r) => r.colour),
    },
    errors: errors.slice(0, MAX_ERRORS_RETURNED),
    errorCount: errors.length,
  }
}
