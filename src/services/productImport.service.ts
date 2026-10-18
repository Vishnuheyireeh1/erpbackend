import { ApiError } from '../utils/ApiError'
import { commitPlan } from './import/import.commit'
import { parseSheet } from './import/import.parse'
import { buildPlan, type ImportPlan } from './import/import.validate'

export { buildTemplate } from './import/import.template'

type Upload = { buffer: Buffer; originalname: string } | undefined

function summary(plan: ImportPlan) {
  return {
    rowCount: plan.rowCount,
    productCount: plan.products.length,
    variantCount: plan.products.reduce((n, p) => n + p.variants.length, 0),
    // Opening stock typed in the sheet (value = qty × Stock cost, else Purchase price).
    stockItems: plan.products.reduce((n, p) => n + p.variants.filter((v) => v.openingStock > 0).length, 0),
    stockValue: Math.round(plan.products.reduce((s, p) => s + p.variants.reduce((t, v) => t + v.openingStock * (v.stockCost ?? v.purchasePrice), 0), 0) * 100) / 100,
    toCreate: plan.toCreate,
    errors: plan.errors,
    errorCount: plan.errorCount,
  }
}

async function planFrom(file: Upload, createMissing: boolean) {
  if (!file) throw ApiError.badRequest('Choose a file to upload')
  const rows = await parseSheet(file.buffer, file.originalname)
  if (rows.length === 0) throw ApiError.badRequest('No product rows found under the header row')
  return buildPlan(rows, createMissing)
}

// Step 1 — check only, nothing is saved.
export async function validateFile(file: Upload, createMissing: boolean) {
  return summary(await planFrom(file, createMissing))
}

// Step 2 — the same file is checked again (never trust an earlier result), then saved.
export async function importFile(file: Upload, createMissing: boolean, user: string) {
  const plan = await planFrom(file, createMissing)
  if (plan.errorCount > 0) {
    return { imported: false as const, ...summary(plan) }
  }
  const result = await commitPlan(plan, user)
  return { imported: true as const, ...result }
}
