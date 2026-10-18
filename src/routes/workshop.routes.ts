import { Router } from 'express'
import * as workshop from '../controllers/workshop.controller'
import { validateBody } from '../middlewares/validate.middleware'
import { costCategorySchema, garmentSchema, measurementSchema, tailorPaymentSchema } from '../validators/workshop.validator'

// /api/tailors, /api/garment-types (customer measurements live under /api/customers/:id/measurements)
export const tailorRoutes = Router()
tailorRoutes.get('/export', workshop.exportTailors)
tailorRoutes.get('/options', workshop.tailorOptions)
tailorRoutes.get('/', workshop.listTailors)
tailorRoutes.get('/:id', workshop.getTailor)
tailorRoutes.get('/:id/statement', workshop.tailorStatement)
tailorRoutes.get('/:id/statement/export', workshop.tailorStatementExport)

export const tailorPaymentRoutes = Router()
tailorPaymentRoutes.get('/export', workshop.exportPayments)
tailorPaymentRoutes.get('/', workshop.listPayments)
tailorPaymentRoutes.get('/:id', workshop.getPayment)
tailorPaymentRoutes.post('/', validateBody(tailorPaymentSchema), workshop.createPayment)
tailorPaymentRoutes.post('/:id/cancel', workshop.cancelPayment)

export const costCategoryRoutes = Router()
costCategoryRoutes.get('/', workshop.listCostCategories)
costCategoryRoutes.post('/', validateBody(costCategorySchema), workshop.createCostCategory)
costCategoryRoutes.put('/:id', validateBody(costCategorySchema), workshop.updateCostCategory)
costCategoryRoutes.delete('/:id', workshop.removeCostCategory)

export const garmentRoutes = Router()
garmentRoutes.get('/export', workshop.exportGarments)
garmentRoutes.get('/', workshop.listGarments)
garmentRoutes.post('/', validateBody(garmentSchema), workshop.createGarment)
garmentRoutes.put('/:id', validateBody(garmentSchema), workshop.updateGarment)
garmentRoutes.delete('/:id', workshop.removeGarment)

export const measurementRoutes = Router({ mergeParams: true })
measurementRoutes.get('/', workshop.listMeasurements)
measurementRoutes.post('/', validateBody(measurementSchema), workshop.createMeasurement)
measurementRoutes.delete('/:mid', workshop.removeMeasurement)
