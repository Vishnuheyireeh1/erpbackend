import { norm } from './import.lookups'
import type { RawRow } from './import.parse'
import type { RowError } from './import.row'
import { newNames, type ImportPlan } from './import.validate'

// Import adds what is right and skips the rest (staff files are rarely all correct):
//   an item is added only when ALL its rows (sizes / colours) are correct — else none of them, so an item never
//   comes in half. Every row not added gets a reason; the other rows of a skipped item say which row stopped them.

export type SplitPlan = { good: ImportPlan; skipped: RowError[]; skippedRows: number }

export function splitPlan(plan: ImportPlan, raw: RawRow[]): SplitPlan {
  const bad = plan.badRows
  // A row that couldn't even be read (e.g. no selling price) still stops the other rows with its product name.
  const badNames = new Set(raw.filter((r) => bad.has(r.rowNo) && r.values.name).map((r) => norm(r.values.name!)))
  const stopperOf = (name: string) => raw.find((r) => bad.has(r.rowNo) && r.values.name && norm(r.values.name) === norm(name))?.rowNo
  const keep = plan.products.filter((p) => !p.variants.some((v) => bad.has(v.rowNo)) && !badNames.has(norm(p.first.name)))
  const siblings: RowError[] = plan.products
    .filter((p) => !keep.includes(p))
    .flatMap((p) => {
      const stopper = p.variants.find((v) => bad.has(v.rowNo))?.rowNo ?? stopperOf(p.first.name)
      return p.variants.filter((v) => !bad.has(v.rowNo)).map((v) => ({ row: v.rowNo, message: `Not added — row ${stopper} of "${p.first.name}" has a problem (all sizes / colours of one item go in together)` }))
    })
  const rows = keep.flatMap((p) => p.variants)
  const skipped = [...plan.errors, ...siblings].sort((a, b) => a.row - b.row)
  return {
    good: { ...plan, products: keep, toCreate: { sizes: newNames(rows, (r) => r.size), colours: newNames(rows, (r) => r.colour) }, errors: [], errorCount: 0, badRows: new Set() },
    skipped,
    skippedRows: plan.rowCount - rows.length,
  }
}
