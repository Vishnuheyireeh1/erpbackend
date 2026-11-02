import { ApiError } from '../utils/ApiError'
import { commitPlan } from './import/import.commit'
import { parseSheet } from './import/import.parse'
import { splitPlan, type SplitPlan } from './import/import.split'
import { EXAMPLE_ROW } from './import/import.template'
import { buildPlan } from './import/import.validate'

export { buildTemplate } from './import/import.template'

type Upload = { buffer: Buffer; originalname: string } | undefined

// What the file gives: items that will be added (all their rows correct) + every row skipped, with its reason.
function summary(rowCount: number, { good, skipped, skippedRows }: SplitPlan) {
  const variants = good.products.flatMap((p) => p.variants)
  return {
    rowCount,
    productCount: good.products.length,
    variantCount: variants.length,
    // Opening stock typed in the sheet (value = qty × Stock cost, else Purchase price).
    stockItems: variants.filter((v) => v.openingStock > 0).length,
    stockValue: Math.round(variants.reduce((t, v) => t + v.openingStock * (v.stockCost ?? v.purchasePrice), 0) * 100) / 100,
    toCreate: good.toCreate,
    skippedRows,
    errors: skipped,
    errorCount: skipped.length,
  }
}

async function planFrom(file: Upload, createMissing: boolean) {
  if (!file) throw ApiError.badRequest('Choose a file to upload')
  // The template's grey "Example —" rows are never imported.
  const rows = (await parseSheet(file.buffer, file.originalname)).filter((r) => !EXAMPLE_ROW.test(r.values.name ?? ''))
  if (rows.length === 0) throw ApiError.badRequest('No product rows found under the header row')
  const plan = await buildPlan(rows, createMissing)
  return { rowCount: plan.rowCount, split: splitPlan(plan, rows) }
}

// Step 1 — check only, nothing is saved.
export async function validateFile(file: Upload, createMissing: boolean) {
  const { rowCount, split } = await planFrom(file, createMissing)
  return summary(rowCount, split)
}

// Step 2 — the same file is checked again (never trust an earlier result); the correct items are saved together,
// the rest are reported back with reasons.
export async function importFile(file: Upload, createMissing: boolean, user: string) {
  const { rowCount, split } = await planFrom(file, createMissing)
  const report = summary(rowCount, split)
  if (split.good.products.length === 0) return { imported: false as const, ...report }
  const result = await commitPlan(split.good, user)
  return { imported: true as const, ...result, ...report }
}
