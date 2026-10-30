// Columns of the product import sheet. ONE ROW = ONE VARIANT.
// Rows with the same product name + category become one product with several variants.

export type ColumnKey =
  | 'name' | 'type' | 'category' | 'subcategory' | 'unit' | 'gst' | 'hsn' | 'fabric'
  | 'size' | 'colour' | 'purchasePrice' | 'sellingPrice' | 'mrp' | 'minStock' | 'openingStock' | 'stockCost' | 'barcode' | 'notes'

export type ColumnDef = { key: ColumnKey; header: string; required?: boolean; width: number; note: string }

export const importColumns: ColumnDef[] = [
  { key: 'name', header: 'Product name', required: true, width: 32, note: 'Same name + category on several rows = one product with variants' },
  { key: 'type', header: 'Type', required: true, width: 16, note: 'A product type from the Lists sheet, e.g. Ready-made, Raw material, Service' },
  { key: 'category', header: 'Category', required: true, width: 22, note: 'Main category (e.g. Kurtis) — see the Lists sheet' },
  { key: 'subcategory', header: 'Sub category', width: 24, note: 'Optional: sub category under it (e.g. Party wear kurtis)' },
  { key: 'unit', header: 'Unit', required: true, width: 10, note: 'Name or code: Piece / pc, Metre / m …' },
  { key: 'gst', header: 'GST %', width: 8, note: 'Optional: 0, 5 or 18' },
  { key: 'hsn', header: 'HSN code', width: 11, note: 'Optional: 4, 6 or 8 digits' },
  { key: 'fabric', header: 'Fabric', width: 16, note: 'Optional' },
  { key: 'size', header: 'Size', width: 9, note: 'Optional: S, M, L …' },
  { key: 'colour', header: 'Colour', width: 12, note: 'Optional' },
  { key: 'purchasePrice', header: 'Purchase price', width: 14, note: 'Optional, number' },
  { key: 'sellingPrice', header: 'Selling price', required: true, width: 13, note: 'Number' },
  { key: 'mrp', header: 'MRP', width: 10, note: 'Optional, number' },
  { key: 'minStock', header: 'Low-stock alert', width: 15, note: 'Optional, number' },
  { key: 'openingStock', header: 'Opening stock', width: 14, note: 'Optional: how many are in the shop today (empty = 0)' },
  { key: 'stockCost', header: 'Stock cost', width: 12, note: 'Optional: cost per piece / metre of that stock — empty = Purchase price' },
  { key: 'barcode', header: 'Barcode', width: 17, note: 'Optional — empty = ERP creates one' },
  { key: 'notes', header: 'Notes', width: 30, note: 'Optional' },
]

// Header text → column key (case / spacing / "*" ignored, a few common aliases).
const aliases: Record<string, ColumnKey> = {
  productname: 'name', name: 'name', item: 'name', itemname: 'name',
  type: 'type', producttype: 'type',
  category: 'category', maincategory: 'category', subcategory: 'subcategory', sub: 'subcategory', unit: 'unit', uom: 'unit',
  gst: 'gst', gstpercent: 'gst', gstrate: 'gst', tax: 'gst',
  hsn: 'hsn', hsncode: 'hsn', fabric: 'fabric', material: 'fabric',
  size: 'size', colour: 'colour', color: 'colour',
  purchaseprice: 'purchasePrice', costprice: 'purchasePrice', cost: 'purchasePrice',
  sellingprice: 'sellingPrice', saleprice: 'sellingPrice', price: 'sellingPrice',
  mrp: 'mrp', lowstockalert: 'minStock', minstock: 'minStock', reorderlevel: 'minStock',
  openingstock: 'openingStock', openingqty: 'openingStock', stock: 'openingStock', stockqty: 'openingStock', qty: 'openingStock', quantity: 'openingStock',
  stockcost: 'stockCost', openingcost: 'stockCost', costofstock: 'stockCost',
  barcode: 'barcode', notes: 'notes', description: 'notes',
}

export function headerKey(header: string): ColumnKey | undefined {
  return aliases[header.toLowerCase().replace(/[^a-z]/g, '')]
}

export const typeLabels: Record<string, 'RAW_MATERIAL' | 'READY_MADE' | 'FINISHED' | 'ACCESSORY' | 'SERVICE'> = {
  readymade: 'READY_MADE', ownmade: 'FINISHED', finished: 'FINISHED', inhouse: 'FINISHED',
  rawmaterial: 'RAW_MATERIAL', raw: 'RAW_MATERIAL', material: 'RAW_MATERIAL',
  accessory: 'ACCESSORY', accessories: 'ACCESSORY', service: 'SERVICE',
}

export const MAX_IMPORT_ROWS = 200_000
