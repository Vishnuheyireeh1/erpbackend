import { Router } from 'express'
import * as brand from '../controllers/brand.controller'
import * as money from '../controllers/brandMoney.controller'
import * as order from '../controllers/brandOrder.controller'
import { validateBody } from '../middlewares/validate.middleware'
import { brandSchema } from '../validators/brand.validator'
import { brandClothSchema, brandDeliverSchema, brandDocCancelSchema, brandPaymentSchema } from '../validators/brandBill.validator'
import { brandCancelSchema, brandMaterialAddSchema, brandOrderCreateSchema, brandOrderUpdateSchema, brandStageSchema } from '../validators/brandOrder.validator'

// /api/brands — brands Sairandhri stitches for.
export const brandRoutes = Router()
brandRoutes.get('/export', brand.exportList)
brandRoutes.get('/', brand.list)
brandRoutes.get('/:id', brand.getOne)
brandRoutes.get('/:id/statement', money.brandStatement)
brandRoutes.get('/:id/statement/export', money.brandStatementExport)
brandRoutes.post('/', validateBody(brandSchema), brand.create)
brandRoutes.put('/:id', validateBody(brandSchema), brand.update)
brandRoutes.delete('/:id', brand.remove)

// /api/brand-orders — their orders (pieces with measurements, tailor, cloth from our stock or theirs).
export const brandOrderRoutes = Router()
brandOrderRoutes.get('/export', order.exportList)
brandOrderRoutes.get('/', order.list)
brandOrderRoutes.get('/:id', order.getOne)
brandOrderRoutes.post('/', validateBody(brandOrderCreateSchema), order.create)
brandOrderRoutes.put('/:id', validateBody(brandOrderUpdateSchema), order.update)
brandOrderRoutes.post('/:id/stage', validateBody(brandStageSchema), order.stage)
brandOrderRoutes.post('/:id/cancel', validateBody(brandCancelSchema), order.cancel)
brandOrderRoutes.post('/:id/materials', validateBody(brandMaterialAddSchema), order.addMaterials)
brandOrderRoutes.delete('/:id/materials/:materialId', order.removeMaterial)
brandOrderRoutes.post('/:id/deliver', validateBody(brandDeliverSchema), money.deliverOrder)
brandOrderRoutes.post('/:id/cloth', validateBody(brandClothSchema), money.clothAdd)
brandOrderRoutes.delete('/:id/cloth/:entryId', money.clothRemove)

// /api/brand-bills — delivery bills; /api/brand-payments — money from brands; /api/reports/brands/:kind
export const brandBillRoutes = Router()
brandBillRoutes.get('/export', money.billsExport)
brandBillRoutes.get('/', money.bills)
brandBillRoutes.get('/:id', money.bill)
brandBillRoutes.post('/:id/cancel', validateBody(brandDocCancelSchema), money.billCancel)

export const brandPaymentRoutes = Router()
brandPaymentRoutes.get('/export', money.paymentsExport)
brandPaymentRoutes.get('/', money.payments)
brandPaymentRoutes.post('/', validateBody(brandPaymentSchema), money.paymentCreate)
brandPaymentRoutes.post('/:id/cancel', validateBody(brandDocCancelSchema), money.paymentCancel)

export const brandReportRoutes = Router()
brandReportRoutes.get('/:kind/export', money.reportExport)
brandReportRoutes.get('/:kind', money.report)
