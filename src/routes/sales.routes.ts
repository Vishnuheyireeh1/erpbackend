import { Router } from 'express'
import * as exporter from '../controllers/export.controller'
import * as sales from '../controllers/sales.controller'
import { validateBody } from '../middlewares/validate.middleware'
import { bookNoSchema, customerSchema, receiptSchema, saleSchema, salesReturnSchema } from '../validators/sales.validator'

// /api/customers, /api/sales, /api/receipts, /api/sales-returns
export const customerRoutes = Router()
customerRoutes.get('/export', exporter.customers)
customerRoutes.get('/', sales.listCustomers)
customerRoutes.get('/:id', sales.getCustomer)
customerRoutes.get('/:id/statement', sales.customerStatement)
customerRoutes.get('/:id/statement/export', exporter.customerStatement)
customerRoutes.get('/:id/unpaid-bills', sales.customerUnpaid)
customerRoutes.get('/:id/advance', sales.customerAdvance)
customerRoutes.post('/', validateBody(customerSchema), sales.createCustomer)
customerRoutes.put('/:id', validateBody(customerSchema), sales.updateCustomer)
customerRoutes.delete('/:id', sales.removeCustomer)

export const salesRoutes = Router()
salesRoutes.get('/export', exporter.salesBills)
salesRoutes.get('/', sales.listSalesBills)
salesRoutes.get('/:id', sales.getSalesBill)
salesRoutes.get('/:id/pdf', sales.salesBillPdf)
salesRoutes.post('/', validateBody(saleSchema), sales.createSalesBill)
salesRoutes.put('/:id', validateBody(saleSchema), sales.editSalesBill)
salesRoutes.post('/:id/cancel', sales.cancelSalesBill)
salesRoutes.put('/:id/book-no', validateBody(bookNoSchema), sales.setSaleBookNo)

export const receiptRoutes = Router()
receiptRoutes.get('/export', exporter.receipts)
receiptRoutes.get('/', sales.listReceipts)
receiptRoutes.get('/:id', sales.getReceipt)
receiptRoutes.post('/', validateBody(receiptSchema), sales.createReceipt)
receiptRoutes.post('/:id/cancel', sales.cancelReceipt)

export const salesReturnRoutes = Router()
salesReturnRoutes.get('/:id', sales.getSalesReturn)
salesReturnRoutes.post('/', validateBody(salesReturnSchema), sales.createSalesReturn)
salesReturnRoutes.post('/:id/cancel', sales.cancelSalesReturn)
