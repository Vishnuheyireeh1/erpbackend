import type { Request, Response } from 'express'
import type { ZodType } from 'zod'
import * as catalog from '../services/export/catalog.export'
import * as inventory from '../services/export/inventory.export'
import * as purchase from '../services/export/purchase.export'
import * as sales from '../services/export/sales.export'
import { billKind } from '../services/sales/bills.query'
import { ApiError } from '../utils/ApiError'
import { documentListSchema, stockListSchema } from '../validators/inventory.validator'
import { listQuerySchema, masterKeys, type MasterKey } from '../validators/master.validator'
import { productListSchema } from '../validators/product.validator'
import { docListSchema } from '../validators/purchase.validator'
import { customerListSchema } from '../validators/sales.validator'
import { supplierListSchema } from '../validators/supplier.validator'

// "Download Excel" for every list. Same query parameters as the list screen; paging is ignored.

function query<T>(schema: ZodType<T>, req: Request): T {
  const r = schema.safeParse(req.query)
  if (!r.success) throw ApiError.badRequest(r.error.issues[0]?.message ?? 'Invalid filters')
  return r.data
}
function readId(req: Request) {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('Invalid id')
  return id
}
const user = (req: Request) => req.admin!.username

export const products = (req: Request, res: Response) => catalog.exportProducts(res, query(productListSchema, req), user(req))

export function master(req: Request, res: Response) {
  const key = req.params.master as MasterKey
  if (!masterKeys.includes(key)) throw ApiError.notFound(`Unknown master: ${req.params.master}`)
  return catalog.exportMaster(res, key, query(listQuerySchema, req), user(req))
}

export const stock = (req: Request, res: Response) => inventory.exportStock(res, query(stockListSchema, req), user(req))
export const ledger = (req: Request, res: Response) => inventory.exportLedger(res, readId(req), user(req), req.query.order === 'oldest' ? 'asc' : 'desc')
export const stockDocuments = (req: Request, res: Response) => inventory.exportStockDocuments(res, query(documentListSchema, req), user(req))

export const suppliers = (req: Request, res: Response) => purchase.exportSuppliers(res, query(supplierListSchema, req), user(req))
export const statement = (req: Request, res: Response) => purchase.exportStatement(res, readId(req), user(req))
export const purchases = (req: Request, res: Response) => purchase.exportPurchases(res, query(docListSchema, req), user(req))
export const payments = (req: Request, res: Response) => purchase.exportPayments(res, query(docListSchema, req), user(req))

const withCustomer = (req: Request) => ({ ...query(docListSchema, req), customerId: Number(req.query.customerId) > 0 ? Number(req.query.customerId) : undefined })
export const customers = (req: Request, res: Response) => sales.exportCustomers(res, query(customerListSchema, req), user(req))
export const customerStatement = (req: Request, res: Response) => sales.exportCustomerStatement(res, readId(req), user(req))
export const salesBills = (req: Request, res: Response) => sales.exportSales(res, { ...withCustomer(req), kind: billKind(req) }, user(req))
export const receipts = (req: Request, res: Response) => sales.exportReceipts(res, withCustomer(req), user(req))
