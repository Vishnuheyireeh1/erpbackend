import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { nextValue } from '../../models/counter.model'
import { internalEan13, productCode, variantSku } from '../../utils/codes'
import { norm } from './import.lookups'
import type { Ref } from './import.row'
import type { ImportPlan } from './import.validate'
import { todayIST } from '../../utils/financialYear'
import { createDocumentTx } from '../inventory/stockDocument.service'
import { getSetting } from '../settings.service'

type Tx = Prisma.TransactionClient

const PRODUCT_BATCH = 1_000 // ~15 values per product → well under PostgreSQL's 65k parameter limit
const VARIANT_BATCH = 2_000
const TX_OPTIONS = { timeout: 10 * 60_000, maxWait: 30_000 }

// Creates the missing brands / sizes / colours, then returns name → id for each.
async function createMissingMasters(tx: Tx, toCreate: ImportPlan['toCreate']) {
  if (toCreate.brands.length) await tx.brand.createMany({ data: toCreate.brands.map((name) => ({ name })), skipDuplicates: true })
  if (toCreate.sizes.length) await tx.size.createMany({ data: toCreate.sizes.map((name) => ({ name, sortOrder: 1000 })), skipDuplicates: true })
  if (toCreate.colours.length) await tx.colour.createMany({ data: toCreate.colours.map((name) => ({ name })), skipDuplicates: true })

  const [brands, sizes, colours] = await Promise.all([
    tx.brand.findMany({ select: { id: true, name: true } }),
    tx.size.findMany({ select: { id: true, name: true } }),
    tx.colour.findMany({ select: { id: true, name: true } }),
  ])
  const toMap = (rows: { id: number; name: string }[]) => new Map(rows.map((r) => [norm(r.name), r]))
  return { brands: toMap(brands), sizes: toMap(sizes), colours: toMap(colours) }
}

// Saves a fully validated plan. All or nothing: any failure rolls everything back.
export async function commitPlan(plan: ImportPlan, user: string) {
  const variantTotal = plan.products.reduce((n, p) => n + p.variants.length, 0)
  const generatedBarcodes = plan.products.reduce((n, p) => n + p.variants.filter((v) => !v.barcode).length, 0)

  const allowNegative = await getSetting('inventory.allowNegativeStock')
  // Opening stock typed in the sheet: SKU → qty and cost (Stock cost, else Purchase price).
  const opening = new Map<string, { qty: number; unitCost: number }>()

  return prisma.$transaction(async (tx) => {
    const masters = await createMissingMasters(tx, plan.toCreate)
    const resolve = (ref: Ref | null, map: Map<string, { id: number; name: string }>) =>
      ref ? (ref.id !== undefined ? { id: ref.id, name: ref.name } : map.get(norm(ref.name))!) : null

    let codeNo = plan.products.length ? await nextValue(tx, 'product', plan.products.length) : 0
    let barcodeNo = generatedBarcodes ? await nextValue(tx, 'barcode', generatedBarcodes) : 0
    const stockLines: { variantId: number; qty: number; unitCost: number }[] = []

    for (let i = 0; i < plan.products.length; i += PRODUCT_BATCH) {
      const batch = plan.products.slice(i, i + PRODUCT_BATCH).map((p) => ({ ...p, code: productCode(codeNo++) }))

      const created = await tx.product.createManyAndReturn({
        data: batch.map(({ first: f, code }) => ({
          code,
          name: f.name,
          type: f.type,
          categoryId: f.categoryId,
          unitId: f.unitId,
          brandId: resolve(f.brand, masters.brands)?.id ?? null,
          taxRateId: f.taxRateId,
          hsnCode: f.hsnCode,
          fabric: f.fabric,
          description: f.notes,
        })),
        select: { id: true, code: true },
      })
      const idByCode = new Map(created.map((c) => [c.code, c.id]))

      const variants = batch.flatMap((p) =>
        p.variants.map((v) => {
          const size = resolve(v.size, masters.sizes)
          const colour = resolve(v.colour, masters.colours)
          const sku = variantSku(p.code, size?.name, colour?.name)
          if (v.openingStock > 0) opening.set(sku, { qty: v.openingStock, unitCost: v.stockCost ?? v.purchasePrice })
          return {
            productId: idByCode.get(p.code)!,
            sku,
            barcode: v.barcode ?? internalEan13(barcodeNo++),
            sizeId: size?.id ?? null,
            colourId: colour?.id ?? null,
            purchasePrice: v.purchasePrice,
            sellingPrice: v.sellingPrice,
            mrp: v.mrp,
            minStock: v.minStock,
          }
        }),
      )
      for (let j = 0; j < variants.length; j += VARIANT_BATCH) {
        const made = await tx.productVariant.createManyAndReturn({ data: variants.slice(j, j + VARIANT_BATCH), select: { id: true, sku: true } })
        for (const m of made) {
          const o = opening.get(m.sku)
          if (o) stockLines.push({ variantId: m.id, ...o })
        }
      }
    }

    // One opening-stock document (OPN/…) for everything with a quantity — stock, value and ledger start at once.
    const stockDoc = stockLines.length
      ? await createDocumentTx(tx, { kind: 'OPENING', reason: 'OPENING', date: new Date(`${todayIST()}T00:00:00Z`), note: 'Opening stock from product import', lines: stockLines }, user, allowNegative)
      : null

    return {
      stock: stockDoc && { docNo: stockDoc.docNo, items: stockLines.length, value: Math.round(stockDoc.totalValue * 100) / 100 },
      products: plan.products.length,
      variants: variantTotal,
      created: {
        brands: plan.toCreate.brands.length,
        sizes: plan.toCreate.sizes.length,
        colours: plan.toCreate.colours.length,
      },
    }
  }, TX_OPTIONS)
}
