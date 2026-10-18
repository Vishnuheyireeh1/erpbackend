import type { Request, Response } from 'express'
import type { ZodType } from 'zod'
import * as customerService from '../services/customer.service'
import * as receiptService from '../services/sales/receipt.service'
import { salePdf } from '../services/sales/sale.pdf'
import { billKind, listBills } from '../services/sales/bills.query'
import { getSale, unpaidDocs } from '../services/sales/sale.query'
import { advanceSources } from '../services/sales/settle.service'
import { prisma } from '../config/prisma'
import * as saleService from '../services/sales/sale.service'
import * as returnService from '../services/sales/salesReturn.service'
import { ApiError } from '../utils/ApiError'
import { cancelDocSchema, docListSchema } from '../validators/purchase.validator'
import * as bookNo from '../services/sales/bookNo.service'
import { customerListSchema, type CustomerInput, type ReceiptInput, type SaleInput, type SalesReturnInput } from '../validators/sales.validator'

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
const customerFilter = (req: Request) => (Number(req.query.customerId) > 0 ? Number(req.query.customerId) : undefined)

// ---- Customers ----
export const listCustomers = async (req: Request, res: Response) => res.json({ success: true, ...(await customerService.list(parse(customerListSchema, req.query))) })
export const getCustomer = async (req: Request, res: Response) => res.json({ success: true, item: await customerService.getById(readId(req)) })
export const createCustomer = async (req: Request, res: Response) => res.status(201).json({ success: true, item: await customerService.create(req.body as CustomerInput, user(req)) })
export const updateCustomer = async (req: Request, res: Response) => res.json({ success: true, item: await customerService.update(readId(req), req.body as CustomerInput, user(req)) })
export async function removeCustomer(req: Request, res: Response) {
  await customerService.remove(readId(req), user(req))
  res.json({ success: true })
}
export const customerStatement = async (req: Request, res: Response) => res.json({ success: true, ...(await customerService.statement(readId(req))) })
export const customerUnpaid = async (req: Request, res: Response) => res.json({ success: true, items: await unpaidDocs(readId(req)) })
// Unused advance + return credit the customer can use on a new bill / job.
export const customerAdvance = async (req: Request, res: Response) => res.json({ success: true, ...(await advanceSources(prisma, readId(req), false)) })

// ---- Sales bills ----
// Shop bills + stitching job bills together (?kind=SHOP|JOB to filter).
export const listSalesBills = async (req: Request, res: Response) => res.json({ success: true, ...(await listBills({ ...parse(docListSchema, req.query), customerId: customerFilter(req), kind: billKind(req) })) })
export const getSalesBill = async (req: Request, res: Response) => res.json({ success: true, item: await getSale(readId(req)) })
export const createSalesBill = async (req: Request, res: Response) => res.status(201).json({ success: true, item: await saleService.createSale(req.body as SaleInput, user(req)) })
export const cancelSalesBill = async (req: Request, res: Response) => res.json({ success: true, item: await saleService.cancelSale(readId(req), parse(cancelDocSchema, req.body).reason, user(req)) })

export async function salesBillPdf(req: Request, res: Response) {
  const { buffer, fileName } = await salePdf(readId(req))
  res.setHeader('Content-Type', 'application/pdf')
  // ?inline=1 opens in the browser (print / share); default downloads.
  res.setHeader('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="${fileName}"`)
  res.send(buffer)
}

// ---- Money received ----
export const listReceipts = async (req: Request, res: Response) => res.json({ success: true, ...(await receiptService.listReceipts({ ...parse(docListSchema, req.query), customerId: customerFilter(req) })) })
export const getReceipt = async (req: Request, res: Response) => res.json({ success: true, item: await receiptService.getReceipt(readId(req)) })
export const createReceipt = async (req: Request, res: Response) => res.status(201).json({ success: true, item: await receiptService.createReceipt(req.body as ReceiptInput, user(req)) })
export const cancelReceipt = async (req: Request, res: Response) => res.json({ success: true, item: await receiptService.cancelReceipt(readId(req), parse(cancelDocSchema, req.body).reason, user(req)) })

// ---- Sales returns ----
export const getSalesReturn = async (req: Request, res: Response) => res.json({ success: true, item: await returnService.getSalesReturn(readId(req)) })
export const createSalesReturn = async (req: Request, res: Response) => res.status(201).json({ success: true, item: await returnService.createSalesReturn(req.body as SalesReturnInput, user(req)) })
export const cancelSalesReturn = async (req: Request, res: Response) => res.json({ success: true, item: await returnService.cancelSalesReturn(readId(req), parse(cancelDocSchema, req.body).reason, user(req)) })

// Paper bill book number — add / correct any time.
export const setSaleBookNo = async (req: Request, res: Response) => res.json({ success: true, ...(await bookNo.setSaleBookNo(readId(req), (req.body as { bookNo: string | null }).bookNo, user(req))) })
