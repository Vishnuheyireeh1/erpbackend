import type { Request, Response } from 'express'
import type { ZodType } from 'zod'
import * as daybook from '../services/finance/daybook.service'
import * as expenses from '../services/finance/expense.service'
import * as money from '../services/finance/money.service'
import { profitAndLoss } from '../services/finance/profit.service'
import { costRows } from '../services/finance/costs.service'
import * as exporter from '../services/export/finance.export'
import { ApiError } from '../utils/ApiError'
import { cancelDocSchema } from '../validators/purchase.validator'
import { costListSchema, financeListSchema, rangeSchema, type ExpenseCategoryInput, type ExpenseInput, type MoneyMoveInput, type TallyInput } from '../validators/finance.validator'

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
const user = (req: Request) => req.admin!.username
const item = (res: Response, value: unknown, status = 200) => res.status(status).json({ success: true, item: value })

// ---- Expenses ----
export const listExpenses = async (req: Request, res: Response) => res.json({ success: true, ...(await expenses.listExpenses(parse(financeListSchema, req.query))) })
export const exportExpenses = (req: Request, res: Response) => exporter.exportExpenses(res, parse(financeListSchema, req.query), user(req))
export const getExpense = async (req: Request, res: Response) => item(res, await expenses.getExpense(readId(req)))
export const createExpense = async (req: Request, res: Response) => item(res, await expenses.createExpense(req.body as ExpenseInput, user(req)), 201)
export const cancelExpense = async (req: Request, res: Response) => item(res, await expenses.cancelExpense(readId(req), parse(cancelDocSchema, req.body).reason, user(req)))

export const listCategories = async (_req: Request, res: Response) => res.json({ success: true, items: await expenses.listCategories() })
export const createCategory = async (req: Request, res: Response) => item(res, await expenses.saveCategory(null, req.body as ExpenseCategoryInput, user(req)), 201)
export const updateCategory = async (req: Request, res: Response) => item(res, await expenses.saveCategory(readId(req), req.body as ExpenseCategoryInput, user(req)))
export async function removeCategory(req: Request, res: Response) {
  await expenses.removeCategory(readId(req), user(req))
  res.json({ success: true })
}

// ---- Cash / bank movements ----
export const listMovements = async (req: Request, res: Response) => res.json({ success: true, ...(await money.listMovements(parse(financeListSchema, req.query))) })
export const exportMovements = (req: Request, res: Response) => exporter.exportMovements(res, parse(financeListSchema, req.query), user(req))
export const createMovement = async (req: Request, res: Response) => item(res, await money.createMovement(req.body as MoneyMoveInput, user(req)), 201)
export const cancelMovement = async (req: Request, res: Response) => item(res, await money.cancelMovement(readId(req), parse(cancelDocSchema, req.body).reason, user(req)))

// ---- Day book, cash tally, profit & loss ----
export const getDayBook = async (req: Request, res: Response) => res.json({ success: true, ...(await daybook.dayBook(parse(rangeSchema, req.query))) })
export const exportDayBook = (req: Request, res: Response) => exporter.exportDayBook(res, parse(rangeSchema, req.query), user(req))
export const getTally = async (req: Request, res: Response) => res.json({ success: true, ...(await daybook.getTally(typeof req.query.date === 'string' ? req.query.date : undefined)) })
export const saveTally = async (req: Request, res: Response) => res.json({ success: true, ...(await daybook.saveTally(req.body as TallyInput, user(req))) })
export const tallyHistory = async (req: Request, res: Response) => res.json({ success: true, items: await daybook.tallyHistory(parse(rangeSchema, req.query)) })
export const getProfit = async (req: Request, res: Response) => res.json({ success: true, ...(await profitAndLoss(parse(rangeSchema, req.query))) })
export const exportProfit = (req: Request, res: Response) => exporter.exportProfit(res, parse(rangeSchema, req.query), user(req))
export const getCosts = async (req: Request, res: Response) => res.json({ success: true, ...(await costRows(parse(costListSchema, req.query))) })
export const exportCosts = (req: Request, res: Response) => exporter.exportCosts(res, parse(costListSchema, req.query), user(req))
