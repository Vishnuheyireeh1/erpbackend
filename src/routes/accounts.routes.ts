import { Router } from 'express'
import * as a from '../controllers/accounts.controller'
import { validateBody } from '../middlewares/validate.middleware'
import { journalSchema, ledgerAccountSchema } from '../validators/accounts.validator'

// /api/accounts
const router = Router()

router.get('/chart', a.chart)
router.get('/chart/export', a.chartExport)
router.post('/chart', validateBody(ledgerAccountSchema), a.createAccount)
router.put('/chart/:id', validateBody(ledgerAccountSchema), a.updateAccount)
router.delete('/chart/:id', a.removeAccount)

router.get('/trial-balance', a.trialBalance)
router.get('/trial-balance/export', a.trialBalanceExport)
router.get('/profit-loss', a.profitLoss)
router.get('/profit-loss/export', a.profitLossExport)
router.get('/balance-sheet', a.balanceSheet)
router.get('/balance-sheet/export', a.balanceSheetExport)

router.get('/ledger/:code', a.ledger)
router.get('/ledger/:code/export', a.ledgerExport)
router.get('/ledger/:code/parties', a.ledgerParties)

router.get('/journals', a.listJournals)
router.get('/journals/export', a.journalsExport)
router.get('/journals/:id', a.getJournal)
router.post('/journals', validateBody(journalSchema), a.createJournal)
router.post('/journals/:id/cancel', a.cancelJournal)

router.get('/sales-by-type', a.salesByType)
router.get('/sales-by-type/export', a.salesByTypeExport)

export default router
