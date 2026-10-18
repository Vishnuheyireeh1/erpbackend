import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../config/prisma'
import { audit } from '../services/audit.service'
import { createBackup } from '../services/system/backup.service'

// Go-live reset — removes TEST entries so the shop starts clean. Run once, before real billing.
//   npm run golive:reset                    → only SHOWS what would be removed (nothing changes)
//   npm run golive:reset -- --yes           → backup first, then remove
//   add --keep-products  to keep products (stock set to 0 — enter opening stock after)
//   add --keep-people    to keep customers, suppliers, brands, tailors and staff (their balances restart from opening)
// Always kept: login, settings, shop details, masters (categories, sizes, colours, GST rates, units, brands),
// garment types, expense types, job cost types, training courses, accounts added in Accounts → Chart.

const DOCUMENTS = [
  'receipt_allocations', 'receipt_tenders', 'credit_allocations', 'sales_return_lines', 'sales_returns', 'customer_receipts',
  'sales_lines', 'sales_invoices', 'job_status_logs', 'job_cost_entries', 'job_costs', 'job_materials', 'job_items', 'stitching_jobs',
  'payment_allocations', 'supplier_payments', 'purchase_return_lines', 'purchase_returns', 'purchase_lines', 'purchase_invoices',
  'stock_movements', 'stock_document_lines', 'stock_documents', 'production_costs', 'production_materials', 'production_outputs', 'production_orders', 'payslips', 'tailor_payments', 'salary_payments', 'expenses', 'money_movements',
  'cash_tallies', 'fee_receipts', 'enrolments', 'journal_lines', 'journal_entries', 'audit_logs',
]
const PEOPLE = ['customer_measurements', 'customers', 'suppliers', 'partner_brands', 'tailor_rates', 'tailors', 'batches', 'students', 'staff']
const PRODUCTS = ['product_variants', 'products']

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--yes')
  const keepProducts = args.includes('--keep-products')
  const keepPeople = args.includes('--keep-people')
  const tables = [...DOCUMENTS, ...(keepPeople ? [] : PEOPLE), ...(keepProducts ? [] : PRODUCTS)]

  console.log(apply ? 'GO-LIVE RESET' : 'GO-LIVE RESET — preview only (add --yes to really do it)')
  for (const t of tables) {
    const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM "${t}"`)
    if (n > 0n) console.log(`  ${t.padEnd(24)} ${n} rows will be removed`)
  }
  if (keepProducts) console.log('  products kept — stock, average cost and stock value set to 0')
  if (!apply) return

  console.log('Backup first …')
  const b = await createBackup('before-reset', 'golive-reset')
  console.log(`  saved ${b.name} (restore with: npm run db:restore -- ${b.name} --yes)`)

  // Counters: document numbers always restart; codes restart only for what is removed.
  const keepCounters = [...(keepProducts ? ['product', 'barcode'] : []), ...(keepPeople ? ['customer', 'supplier', 'partnerBrand', 'tailor', 'staff', 'student'] : [])]
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`)
    if (keepProducts) await tx.$executeRawUnsafe('UPDATE "product_variants" SET stock_qty = 0, avg_cost = 0, stock_value = 0')
    await tx.counter.deleteMany({ where: { key: { notIn: keepCounters } } })
    await audit(tx, { actor: 'golive-reset', action: 'system.golive_reset', entity: 'system', entityId: 'reset', summary: `Go-live reset: test entries removed (backup ${b.name})${keepProducts ? ', products kept' : ''}${keepPeople ? ', people kept' : ''}` })
  }, { timeout: 120_000 })

  // Photos of removed jobs / products.
  const uploads = path.resolve(__dirname, '../../uploads')
  for (const dir of ['jobs', ...(keepProducts ? [] : ['products'])]) {
    const p = path.join(uploads, dir)
    if (fs.existsSync(p)) await fs.promises.rm(p, { recursive: true, force: true })
  }
  console.log('Done — clean start. Next: shop details, opening stock, opening cash & bank, old balances (Settings → Go-live checklist).')
}

main()
  .catch((err) => {
    console.error('Reset failed — nothing was removed:', (err as Error).message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
