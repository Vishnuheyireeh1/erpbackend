import { Router } from 'express'
import * as p from '../controllers/production.controller'
import { validateBody } from '../middlewares/validate.middleware'
import { productionSchema } from '../validators/production.validator'

// /api/production — production entries (PRD/…)
const productionRoutes = Router()
productionRoutes.get('/export', p.exportList)
productionRoutes.get('/', p.list)
productionRoutes.get('/:id', p.getOne)
productionRoutes.post('/', validateBody(productionSchema), p.create)
productionRoutes.post('/:id/cancel', p.cancel)

export default productionRoutes
