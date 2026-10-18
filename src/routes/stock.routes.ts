import { Router } from 'express'
import * as exporter from '../controllers/export.controller'
import * as stock from '../controllers/stock.controller'
import { singleSpreadsheet } from '../middlewares/upload.middleware'
import { validateBody } from '../middlewares/validate.middleware'
import { adjustmentSchema, openingSchema } from '../validators/inventory.validator'

// /api/stock
const router = Router()

router.get('/export', exporter.stock)
router.get('/', stock.list)
router.get('/summary', stock.summary)
router.get('/items/:id/ledger', stock.ledger)
router.get('/items/:id/ledger/export', exporter.ledger)

router.get('/documents', stock.listDocuments)
router.get('/documents/export', exporter.stockDocuments)
router.get('/documents/:id', stock.getDocument)
router.post('/opening', validateBody(openingSchema), stock.createOpening)
router.get('/opening/template', stock.openingTemplate)
router.post('/opening/import/check', singleSpreadsheet, stock.openingCheck)
router.post('/opening/import', singleSpreadsheet, stock.openingImportFile)
router.post('/adjustments', validateBody(adjustmentSchema), stock.createAdjustment)
router.post('/documents/:id/cancel', stock.cancelDocument)

export default router
