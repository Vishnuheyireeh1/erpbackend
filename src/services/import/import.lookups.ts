import { prisma } from '../../config/prisma'

// Everything validation needs, loaded once per import (masters are small tables).

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
const CHUNK = 5_000

export async function loadLookups() {
  const [productTypes, categories, units, taxRates, sizes, colours] = await Promise.all([
    prisma.productTypeMaster.findMany({ orderBy: { id: 'asc' }, select: { id: true, name: true, kind: true } }),
    prisma.category.findMany({ select: { id: true, name: true, parentId: true, parent: { select: { name: true } } } }),
    prisma.unit.findMany({ select: { id: true, name: true, code: true, allowDecimal: true } }),
    prisma.taxRate.findMany({ select: { id: true, rate: true } }),
    prisma.size.findMany({ select: { id: true, name: true } }),
    prisma.colour.findMany({ select: { id: true, name: true } }),
  ])

  // Category by "main › sub" path, and by bare name (may be ambiguous).
  const categoryByPath = new Map<string, number>()
  const categoryByName = new Map<string, number[]>()
  for (const c of categories) {
    const path = c.parent ? `${norm(c.parent.name)}>${norm(c.name)}` : norm(c.name)
    categoryByPath.set(path, c.id)
    categoryByName.set(norm(c.name), [...(categoryByName.get(norm(c.name)) ?? []), c.id])
  }

  const unitByKey = new Map<string, number>()
  for (const u of units) {
    unitByKey.set(norm(u.name), u.id)
    unitByKey.set(norm(u.code), u.id)
  }

  // Product type by its name ("Saree"), and the first type of each kind (old files that say "Finished").
  const typeByKind = new Map<string, number>()
  for (const t of [...productTypes].reverse()) typeByKind.set(t.kind, t.id)

  return {
    typeByName: new Map(productTypes.map((t) => [norm(t.name), t])),
    typeByKind,
    categoryByPath,
    categoryByName,
    unitByKey,
    unitAllowsDecimal: new Map(units.map((u) => [u.id, u.allowDecimal])),
    taxByRate: new Map(taxRates.map((t) => [Number(t.rate), t.id])),
    sizeByName: new Map(sizes.map((s) => [norm(s.name), s])),
    colourByName: new Map(colours.map((c) => [norm(c.name), c])),
  }
}

export type Lookups = Awaited<ReturnType<typeof loadLookups>>

// Products that already exist with one of these names → "name|categoryId" keys.
export async function existingProductKeys(names: string[]) {
  const keys = new Map<string, string>() // key → product code
  for (let i = 0; i < names.length; i += CHUNK) {
    const rows = await prisma.product.findMany({
      where: { name: { in: names.slice(i, i + CHUNK), mode: 'insensitive' } },
      select: { name: true, categoryId: true, code: true },
    })
    for (const r of rows) keys.set(`${norm(r.name)}|${r.categoryId}`, r.code)
  }
  return keys
}

// Barcodes from the file that are already used in the database.
export async function existingBarcodes(barcodes: string[]) {
  const used = new Set<string>()
  for (let i = 0; i < barcodes.length; i += CHUNK) {
    const rows = await prisma.productVariant.findMany({
      where: { barcode: { in: barcodes.slice(i, i + CHUNK) } },
      select: { barcode: true },
    })
    rows.forEach((r) => used.add(r.barcode))
  }
  return used
}

export { norm }
