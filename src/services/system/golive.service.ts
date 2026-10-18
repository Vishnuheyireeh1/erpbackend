import bcrypt from 'bcryptjs'
import { prisma } from '../../config/prisma'
import { env } from '../../config/env'
import { todayIST } from '../../utils/financialYear'
import { getSetting } from '../settings.service'
import { list as numbering } from '../numbering.service'
import { hasBackupForDay, listBackups } from './backup.service'

// Settings → "Go-live checklist": what must be ready before the shop starts using the ERP for real.
// done = ready, todo = still to do, info = just a number to look at.

type Status = 'done' | 'todo' | 'info'
type Item = { key: string; title: string; status: Status; detail: string; link?: string }

// Passwords that must never stay on a live system.
const weakPasswords = ['Admin@123', 'admin', 'admin123', 'password', 'change_me']
// bcrypt is slow on purpose (~0.5 s per check) → remember the answer per password hash (changes with the password).
const weakCache = new Map<string, boolean>()
async function isWeak(hash: string) {
  if (!weakCache.has(hash)) {
    let weak = false
    for (const p of weakPasswords) if ((weak = await bcrypt.compare(p, hash))) break
    weakCache.set(hash, weak)
  }
  return weakCache.get(hash)!
}

export async function checklist() {
  const [profile, opening, admins, counts, opn, oldBalances, series, backups] = await Promise.all([
    getSetting('business.profile'),
    getSetting('money.opening'),
    prisma.admin.findMany({ select: { username: true, passwordHash: true } }),
    Promise.all([
      prisma.salesInvoice.count(), prisma.stitchingJob.count(), prisma.purchaseInvoice.count(), prisma.customer.count(),
      prisma.product.count(), prisma.productVariant.count({ where: { stockQty: { gt: 0 } } }), prisma.tailor.count({ where: { isActive: true } }), prisma.staff.count({ where: { isActive: true } }),
    ]),
    prisma.stockDocument.count({ where: { kind: 'OPENING', status: 'POSTED' } }),
    Promise.all([prisma.customer.count({ where: { openingBalance: { not: 0 } } }), prisma.supplier.count({ where: { openingBalance: { not: 0 } } })]),
    numbering(),
    listBackups(),
  ])
  const [bills, jobs, purchases, customers, products, inStock, tailors, staff] = counts
  const weak = (await Promise.all(admins.map((a) => isWeak(a.passwordHash)))).some(Boolean)
  const next = (key: string) => series.items.find((s) => s.key === key)?.nextDocNo ?? '—'
  const backedUpToday = await hasBackupForDay(todayIST())
  const missing = [!profile.addressLine1 && 'address', !profile.phone && 'phone', profile.gstRegistered && !profile.gstin && 'GSTIN'].filter(Boolean)

  const items: Item[] = [
    { key: 'password', title: 'Admin password changed', status: weak ? 'todo' : 'done', detail: weak ? 'Still a simple / default password — change it (top right → Change password).' : 'Not a default password.' },
    { key: 'profile', title: 'Shop details on bills', status: missing.length ? 'todo' : 'done', detail: missing.length ? `Fill the ${missing.join(', ')} in Settings → Business profile.` : `${profile.shopName}${profile.gstin ? ` · GSTIN ${profile.gstin}` : ''}`, link: '/settings' },
    { key: 'test-data', title: 'Test entries cleared', status: bills + jobs + purchases ? 'info' : 'done', detail: bills + jobs + purchases ? `${bills} sales bills, ${jobs} jobs, ${purchases} purchase bills, ${customers} customers are in the system. If these are tests, run the go-live reset (README → Go-live) before real billing.` : 'No bills yet — clean start.' },
    { key: 'numbers', title: 'Bill numbers', status: 'info', detail: `Next sales bill ${next('SALE')}, next job ${next('JOB')}. To continue from the old book, set it in Settings → Document numbers.`, link: '/settings' },
    { key: 'products', title: 'Products added', status: products ? 'done' : 'todo', detail: products ? `${products} products, ${inStock} items with stock.` : 'Add products or import the Excel (Products → Import).', link: '/products' },
    { key: 'opening-stock', title: 'Opening stock entered', status: opn ? 'done' : 'todo', detail: opn ? `${opn} opening stock entries.` : 'Enter what is on the shelves (Excel import with Opening stock, or Stock → Opening stock).', link: '/stock/documents' },
    { key: 'opening-money', title: 'Opening cash & bank', status: opening.cash || opening.bank ? 'done' : 'todo', detail: opening.cash || opening.bank ? `Cash ₹${opening.cash}, bank ₹${opening.bank}.` : 'Cash in the drawer and bank balance on day one (Settings → Opening balances).', link: '/settings' },
    { key: 'old-balances', title: 'Old balances of customers & suppliers', status: 'info', detail: `${oldBalances[0]} customers and ${oldBalances[1]} suppliers have an opening balance. Add what they owe / you owe from the old book.` },
    { key: 'people', title: 'Tailors & staff', status: tailors ? 'done' : 'todo', detail: `${tailors} tailors, ${staff} staff.`, link: '/tailors' },
    { key: 'backup', title: 'Backups working', status: backedUpToday && !backups.lastError ? 'done' : 'todo', detail: backups.lastError ? `Last backup failed: ${backups.lastError.message}` : backedUpToday ? `Backed up today. ${backups.items.length} backups kept in ${backups.folder}.` : 'No backup today yet — press "Back up now".' },
    { key: 'backup-copy', title: 'Backup copy outside this PC', status: env.backup.copyDir && !backups.lastCopyError ? 'done' : 'todo', detail: backups.lastCopyError ?? (env.backup.copyDir ? `Copied to ${env.backup.copyDir}.` : 'Set BACKUP_COPY_DIR to a pen drive or OneDrive / Google Drive folder, so a PC failure loses nothing.') },
  ]
  return { items, done: items.filter((i) => i.status === 'done').length, todo: items.filter((i) => i.status === 'todo').length }
}
