import type { Request, Response } from 'express'
import type { ZodType } from 'zod'
import * as books from '../services/accounts/books.service'
import { KIND_LABEL, loadChart } from '../services/accounts/chart'
import * as journals from '../services/accounts/journal.service'
import * as ledgers from '../services/accounts/ledger.service'
import * as exporter from '../services/export/accounts.export'
import { ApiError } from '../utils/ApiError'
import { journalListSchema, ledgerSchema, periodSchema, salesTypeSchema, type JournalInput, type LedgerAccountInput } from '../validators/accounts.validator'
import { cancelDocSchema } from '../validators/purchase.validator'

// /api/accounts — chart of accounts, books (trial balance, P&L, balance sheet), ledgers, journal entries.

function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data ?? {})
  if (!r.success) throw ApiError.badRequest(r.error.issues[0]?.message ?? 'Invalid input')
  return r.data
}
function readId(req: Request) {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('Invalid id')
  return id
}
const code = (req: Request) => String(req.params.code).slice(0, 20)
const user = (req: Request) => req.admin!.username
const ok = (res: Response, body: object) => res.json({ success: true, ...body })
const item = (res: Response, value: unknown, status = 200) => res.status(status).json({ success: true, item: value })

// ---- Chart of accounts ----
export const chart = async (_req: Request, res: Response) => ok(res, { items: await loadChart(), groups: KIND_LABEL, locked: journals.lockedAccounts })
export const chartExport = (req: Request, res: Response) => exporter.exportChart(res, user(req))
export const createAccount = async (req: Request, res: Response) => item(res, await journals.createAccount(req.body as LedgerAccountInput, user(req)), 201)
export const updateAccount = async (req: Request, res: Response) => item(res, await journals.updateAccount(readId(req), req.body as LedgerAccountInput, user(req)))
export async function removeAccount(req: Request, res: Response) {
  await journals.removeAccount(readId(req), user(req))
  res.json({ success: true })
}

// ---- Books ----
export const trialBalance = async (req: Request, res: Response) => ok(res, await books.trialBalance(parse(periodSchema, req.query)))
export const trialBalanceExport = (req: Request, res: Response) => exporter.exportTrialBalance(res, parse(periodSchema, req.query), user(req))
export const profitLoss = async (req: Request, res: Response) => ok(res, await books.profitLoss(parse(periodSchema, req.query)))
export const profitLossExport = (req: Request, res: Response) => exporter.exportProfitLoss(res, parse(periodSchema, req.query), user(req))
export const balanceSheet = async (req: Request, res: Response) => ok(res, await books.balanceSheet(parse(periodSchema, req.query)))
export const balanceSheetExport = (req: Request, res: Response) => exporter.exportBalanceSheet(res, parse(periodSchema, req.query), user(req))

// ---- Ledger ----
export const ledger = async (req: Request, res: Response) => ok(res, await ledgers.ledger(code(req), parse(ledgerSchema, req.query)))
export const ledgerExport = (req: Request, res: Response) => exporter.exportLedger(res, code(req), parse(ledgerSchema, req.query), user(req))
export const ledgerParties = async (req: Request, res: Response) => ok(res, { items: await ledgers.ledgerParties(code(req), parse(periodSchema, req.query)) })

// ---- Journal entries ----
export const listJournals = async (req: Request, res: Response) => ok(res, await journals.listJournals(parse(journalListSchema, req.query)))
export const journalsExport = (req: Request, res: Response) => exporter.exportJournals(res, parse(journalListSchema, req.query), user(req))
export const getJournal = async (req: Request, res: Response) => item(res, await journals.getJournal(readId(req)))
export const createJournal = async (req: Request, res: Response) => item(res, await journals.createJournal(req.body as JournalInput, user(req)), 201)
export const cancelJournal = async (req: Request, res: Response) => item(res, await journals.cancelJournal(readId(req), parse(cancelDocSchema, req.body).reason, user(req)))

// ---- Sales by type (Reports) ----
export const salesByType = async (req: Request, res: Response) => ok(res, await ledgers.salesByType(parse(salesTypeSchema, req.query)))
export const salesByTypeExport = (req: Request, res: Response) => exporter.exportSalesByType(res, parse(salesTypeSchema, req.query), user(req))
