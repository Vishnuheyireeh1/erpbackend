import { byDate } from '../../utils/order'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import { dateRange, nextDocNo, toDocDate } from '../../utils/financialYear'
import type { JournalInput, JournalListQuery, LedgerAccountInput } from '../../validators/accounts.validator'
import { audit } from '../audit.service'
import { accountMap, type AccountKind } from './chart'

// The owner's / CA's own accounts (machines, loans …) and journal entries (JV/…). Journals are never edited —
// cancelled with a reason, like every other document.

// These follow their own documents (customer / supplier / tailor statements, the Stock page) — never by journal.
const LOCKED: Record<string, string> = {
  '1100': 'Customers change only through bills, money received and returns',
  '2000': 'Suppliers change only through purchase bills, payments and returns',
  '2100': 'Tailor dues change only through jobs and tailor payments',
  '1110': 'Brands change only through delivery bills and money received from brands',
  '1200': 'Stock changes only through stock entries (Stock → adjustments)',
}
const KIND_DIGIT: Record<AccountKind, string> = { ASSET: '1', LIABILITY: '2', EQUITY: '3', INCOME: '4', DIRECT_EXPENSE: '5', INDIRECT_EXPENSE: '6' }

export async function createAccount(input: LedgerAccountInput, user: string) {
  const head = `${KIND_DIGIT[input.kind]}9`
  const last = await prisma.ledgerAccount.findFirst({ where: { code: { startsWith: head } }, orderBy: { code: 'desc' } })
  const code = last ? String(Number(last.code) + 1) : `${head}01` // 1901, 1902 … (built-in codes never use x9xx)
  if (await prisma.ledgerAccount.findUnique({ where: { name: input.name } })) throw ApiError.conflict(`"${input.name}" already exists`)
  return prisma.$transaction(async (tx) => {
    const a = await tx.ledgerAccount.create({ data: { ...input, code } })
    await audit(tx, { actor: user, action: 'account.create', entity: 'ledger_account', entityId: a.id, summary: `Account ${code} ${a.name} (${a.kind})` })
    return a
  })
}

export async function updateAccount(id: number, input: LedgerAccountInput, user: string) {
  const a = await prisma.ledgerAccount.findUnique({ where: { id } })
  if (!a) throw ApiError.notFound('Account not found')
  const clash = await prisma.ledgerAccount.findFirst({ where: { name: input.name, id: { not: id } } })
  if (clash) throw ApiError.conflict(`"${input.name}" already exists`)
  const used = await prisma.journalLine.count({ where: { accountCode: a.code } })
  if (used && input.kind !== a.kind) throw ApiError.conflict('This account has entries — its group can no longer change')
  return prisma.$transaction(async (tx) => {
    const saved = await tx.ledgerAccount.update({ where: { id }, data: input })
    await audit(tx, { actor: user, action: 'account.update', entity: 'ledger_account', entityId: id, summary: `Account ${a.code} ${input.name}` })
    return saved
  })
}

export async function removeAccount(id: number, user: string) {
  const a = await prisma.ledgerAccount.findUnique({ where: { id } })
  if (!a) throw ApiError.notFound('Account not found')
  if (await prisma.journalLine.count({ where: { accountCode: a.code } })) throw ApiError.conflict(`${a.name} has journal entries — make it inactive instead`)
  await prisma.$transaction(async (tx) => {
    await tx.ledgerAccount.delete({ where: { id } })
    await audit(tx, { actor: user, action: 'account.delete', entity: 'ledger_account', entityId: id, summary: `Account ${a.code} ${a.name} deleted` })
  })
}

export async function createJournal(input: JournalInput, user: string) {
  const { date, isFuture } = toDocDate(input.docDate)
  if (isFuture) throw ApiError.badRequest("Date can't be in the future")
  const map = await accountMap()
  for (const l of input.lines) {
    const a = map.get(l.accountCode)
    if (!a) throw ApiError.badRequest(`Account ${l.accountCode} not found`)
    if (!a.isActive) throw ApiError.badRequest(`${a.name} is inactive`)
    if (LOCKED[a.code]) throw ApiError.badRequest(`${a.name}: ${LOCKED[a.code]}`)
  }
  const total = Math.round(input.lines.reduce((s, l) => s + l.debit, 0) * 100) / 100
  const id = await prisma.$transaction(async (tx) => {
    const docNo = await nextDocNo(tx, 'JV', date)
    const e = await tx.journalEntry.create({
      data: {
        docNo, docDate: date, narration: input.narration, total, createdBy: user,
        lines: { create: input.lines.map((l, i) => ({ accountCode: l.accountCode, debit: l.debit, credit: l.credit, note: l.note, sortOrder: i })) },
      },
    })
    await audit(tx, { actor: user, action: 'journal.post', entity: 'journal', entityId: e.id, summary: `${docNo} ₹${total} — ${input.narration}` })
    return e.id
  })
  return getJournal(id)
}

export async function cancelJournal(id: number, reason: string, user: string) {
  await prisma.$transaction(async (tx) => {
    const e = await tx.journalEntry.findUnique({ where: { id } })
    if (!e) throw ApiError.notFound('Journal entry not found')
    const done = await tx.journalEntry.updateMany({ where: { id, status: 'POSTED' }, data: { status: 'CANCELLED', cancelledBy: user, cancelledAt: new Date(), cancelReason: reason } })
    if (done.count === 0) throw ApiError.conflict(`${e.docNo} is already cancelled`)
    await audit(tx, { actor: user, action: 'journal.cancel', entity: 'journal', entityId: id, summary: `${e.docNo} cancelled — ${reason}` })
  })
  return getJournal(id)
}

export async function getJournal(id: number) {
  const [e, map] = await Promise.all([prisma.journalEntry.findUnique({ where: { id }, include: { lines: { orderBy: { sortOrder: 'asc' } } } }), accountMap()])
  if (!e) throw ApiError.notFound('Journal entry not found')
  return { ...e, lines: e.lines.map((l) => ({ ...l, accountName: map.get(l.accountCode)?.name ?? l.accountCode })) }
}

export async function listJournals(q: JournalListQuery) {
  const where = { ...(q.status !== 'all' ? { status: q.status } : {}), ...(dateRange(q.from, q.to) ? { docDate: dateRange(q.from, q.to) } : {}) }
  const [items, total] = await Promise.all([
    prisma.journalEntry.findMany({ where, orderBy: byDate(q.order), skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.journalEntry.count({ where }),
  ])
  return { items, total, page: q.page, pageSize: q.pageSize }
}

export const lockedAccounts = Object.keys(LOCKED)
