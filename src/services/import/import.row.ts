import type { ProductType } from '../../generated/prisma/client'
import { importColumns, typeLabels, type ColumnKey } from './import.columns'
import { norm, type Lookups } from './import.lookups'
import type { RawRow } from './import.parse'

export type RowError = { row: number; column?: string; message: string }

/** Existing master (id) or one to create on import (name only). */
export type Ref = { id?: number; name: string }

export type ParsedRow = {
  rowNo: number
  name: string
  type: ProductType
  productTypeId: number | null
  categoryId: number
  unitId: number
  taxRateId: number | null
  hsnCode: string | null
  fabric: string | null
  notes: string | null
  size: Ref | null
  colour: Ref | null
  purchasePrice: number
  sellingPrice: number
  mrp: number | null
  minStock: number
  openingStock: number // 0 = no stock yet
  stockCost: number | null // null = use purchase price
  barcode: string | null
}

const header = (key: ColumnKey) => importColumns.find((c) => c.key === key)!.header

// Turns one sheet row into clean values, or returns its errors.
export function parseRow(raw: RawRow, lk: Lookups, createMissing: boolean) {
  const v = raw.values
  const errors: RowError[] = []
  const fail = (key: ColumnKey, message: string) => {
    errors.push({ row: raw.rowNo, column: header(key), message })
    return null
  }

  const text = (key: ColumnKey, max: number, required = false) => {
    const s = v[key]?.trim() ?? ''
    if (!s) return required ? fail(key, 'Required') : null
    return s.length > max ? fail(key, `Too long (max ${max} characters)`) : s
  }

  const number = (key: ColumnKey, required = false) => {
    const s = v[key]?.replace(/[₹,\s]/g, '') ?? ''
    if (!s) return required ? fail(key, 'Required') : null
    const n = Number(s)
    if (!Number.isFinite(n) || n < 0 || n > 9_999_999) return fail(key, `"${v[key]}" is not a valid amount`)
    return Math.round(n * 1000) / 1000
  }

  // Size / colour: existing by name, or new (if allowed).
  const ref = (key: ColumnKey, map: Map<string, { id: number; name: string }>, label: string): Ref | null => {
    const s = text(key, 40)
    if (!s) return null
    const found = map.get(norm(s))
    if (found) return { id: found.id, name: found.name }
    if (createMissing) return { name: s }
    return fail(key, `${label} "${s}" not found — add it in Masters or tick "create missing"`)
  }

  const name = text('name', 150, true)

  const typeText = v.type?.trim() ?? ''
  // A product type by name (any added in Masters), else the old built-in words (Finished, In-house …).
  const named = typeText ? lk.typeByName.get(norm(typeText)) : undefined
  const type = named?.kind ?? (typeText ? typeLabels[typeText.toLowerCase().replace(/[^a-z]/g, '')] : undefined)
  const productTypeId = named?.id ?? (type ? lk.typeByKind.get(type) ?? null : null)
  if (!typeText) fail('type', 'Required')
  else if (!type) fail('type', `"${typeText}" — use a product type from the Lists sheet (e.g. Ready-made)`)

  let categoryId: number | null = null
  const cat = v.category?.trim()
  const sub = v.subcategory?.trim()
  if (!cat) fail('category', 'Required')
  else if (sub) {
    // Category + Sub category columns → the sub category under that main category.
    categoryId = lk.categoryByPath.get(`${norm(cat)}>${norm(sub)}`) ?? fail('subcategory', `"${sub}" is not a sub category of "${cat}" — see the Lists sheet`)
  } else if (/[>›]/.test(cat)) {
    const path = cat.split(/[>›]/).map(norm).join('>')
    categoryId = lk.categoryByPath.get(path) ?? fail('category', `Category "${cat}" not found`)
  } else {
    const ids = lk.categoryByName.get(norm(cat)) ?? []
    if (ids.length === 1) categoryId = ids[0]
    else fail('category', ids.length ? `"${cat}" exists under several main categories — write it as Main > ${cat}` : `Category "${cat}" not found`)
  }

  const unitText = v.unit?.trim()
  const unitId = !unitText ? fail('unit', 'Required') : (lk.unitByKey.get(norm(unitText)) ?? fail('unit', `Unit "${unitText}" not found`))

  let taxRateId: number | null = null
  if (v.gst) {
    const rate = Number(v.gst.replace(/[^0-9.]/g, ''))
    taxRateId = lk.taxByRate.get(rate) ?? fail('gst', `GST rate "${v.gst}" not found in Masters`)
  }

  const hsn = v.hsn?.replace(/\s/g, '') ?? ''
  if (hsn && !/^(\d{4}|\d{6}|\d{8})$/.test(hsn)) fail('hsn', 'HSN code must be 4, 6 or 8 digits')

  const barcode = v.barcode?.trim() || null
  if (barcode && !/^[A-Za-z0-9-]{1,30}$/.test(barcode)) fail('barcode', 'Only letters, numbers and dashes (max 30)')

  const row = {
    rowNo: raw.rowNo,
    size: ref('size', lk.sizeByName, 'Size'),
    colour: ref('colour', lk.colourByName, 'Colour'),
    fabric: text('fabric', 80),
    notes: text('notes', 1000),
    purchasePrice: number('purchasePrice') ?? 0,
    sellingPrice: number('sellingPrice', true),
    mrp: number('mrp'),
    minStock: number('minStock') ?? 0,
    openingStock: number('openingStock') ?? 0,
    stockCost: number('stockCost'),
  }
  // Opening stock: services have none; pieces must be whole numbers (metre may have decimals).
  if (row.openingStock > 0 && type === 'SERVICE') fail('openingStock', 'A service has no stock — leave it empty')
  else if (row.openingStock > 0 && unitId && !lk.unitAllowsDecimal.get(unitId) && !Number.isInteger(row.openingStock)) fail('openingStock', `Whole numbers only for ${unitText}`)
  if (row.stockCost !== null && !(row.openingStock > 0)) fail('stockCost', 'Stock cost needs an Opening stock quantity')

  if (errors.length > 0) return { errors }
  const parsed: ParsedRow = {
    ...row,
    name: name!,
    type: type!,
    productTypeId,
    categoryId: categoryId!,
    unitId: unitId!,
    taxRateId,
    hsnCode: hsn || null,
    sellingPrice: row.sellingPrice!,
    barcode,
  }
  return { row: parsed, errors }
}
