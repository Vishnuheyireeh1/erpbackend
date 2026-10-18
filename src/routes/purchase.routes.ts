import { Router } from 'express'
import * as exporter from '../controllers/export.controller'
import * as purchase from '../controllers/purchase.controller'
import * as supplier from '../controllers/supplier.controller'
import { validateBody } from '../middlewares/validate.middleware'
import { freightPaidSchema, paymentSchema, purchaseReturnSchema, purchaseSchema } from '../validators/purchase.validator'
import { supplierSchema } from '../validators/supplier.validator'

// /api/suppliers, /api/purchases, /api/supplier-payments, /api/purchase-returns
export const supplierRoutes = Router()
supplierRoutes.get('/export', exporter.suppliers)
supplierRoutes.get('/', supplier.list)
supplierRoutes.get('/:id', supplier.getOne)
supplierRoutes.get('/:id/statement', supplier.statement)
supplierRoutes.get('/:id/statement/export', exporter.statement)
supplierRoutes.get('/:id/unpaid-bills', supplier.unpaid)
supplierRoutes.post('/', validateBody(supplierSchema), supplier.create)
supplierRoutes.put('/:id', validateBody(supplierSchema), supplier.update)
supplierRoutes.delete('/:id', supplier.remove)

export const purchaseRoutes = Router()
purchaseRoutes.get('/export', exporter.purchases)
purchaseRoutes.get('/', purchase.list)
purchaseRoutes.get('/:id', purchase.getOne)
purchaseRoutes.post('/', validateBody(purchaseSchema), purchase.create)
purchaseRoutes.post('/:id/cancel', purchase.cancel)
purchaseRoutes.post('/:id/freight-paid', validateBody(freightPaidSchema), purchase.freightPaid)

export const paymentRoutes = Router()
paymentRoutes.get('/export', exporter.payments)
paymentRoutes.get('/', purchase.listPayments)
paymentRoutes.get('/:id', purchase.getPayment)
paymentRoutes.post('/', validateBody(paymentSchema), purchase.createPayment)
paymentRoutes.post('/:id/cancel', purchase.cancelPayment)

export const returnRoutes = Router()
returnRoutes.get('/:id', purchase.getReturn)
returnRoutes.post('/', validateBody(purchaseReturnSchema), purchase.createReturn)
returnRoutes.post('/:id/cancel', purchase.cancelReturn)
