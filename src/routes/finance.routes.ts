import { Router } from 'express'
import * as f from '../controllers/finance.controller'
import { validateBody } from '../middlewares/validate.middleware'
import { expenseCategorySchema, expenseSchema, moneyMoveSchema, tallySchema } from '../validators/finance.validator'

// /api/expenses, /api/expense-categories, /api/money-movements, /api/finance/*
export const expenseRoutes = Router()
expenseRoutes.get('/export', f.exportExpenses)
expenseRoutes.get('/', f.listExpenses)
expenseRoutes.get('/:id', f.getExpense)
expenseRoutes.post('/', validateBody(expenseSchema), f.createExpense)
expenseRoutes.post('/:id/cancel', f.cancelExpense)

export const expenseCategoryRoutes = Router()
expenseCategoryRoutes.get('/', f.listCategories)
expenseCategoryRoutes.post('/', validateBody(expenseCategorySchema), f.createCategory)
expenseCategoryRoutes.put('/:id', validateBody(expenseCategorySchema), f.updateCategory)
expenseCategoryRoutes.delete('/:id', f.removeCategory)

export const movementRoutes = Router()
movementRoutes.get('/export', f.exportMovements)
movementRoutes.get('/', f.listMovements)
movementRoutes.post('/', validateBody(moneyMoveSchema), f.createMovement)
movementRoutes.post('/:id/cancel', f.cancelMovement)

export const financeRoutes = Router()
financeRoutes.get('/day-book', f.getDayBook)
financeRoutes.get('/day-book/export', f.exportDayBook)
financeRoutes.get('/tally', f.getTally)
financeRoutes.post('/tally', validateBody(tallySchema), f.saveTally)
financeRoutes.get('/tally/history', f.tallyHistory)
financeRoutes.get('/profit', f.getProfit)
financeRoutes.get('/profit/export', f.exportProfit)
financeRoutes.get('/costs', f.getCosts)
financeRoutes.get('/costs/export', f.exportCosts)
