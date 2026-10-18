import type { Request, Response } from 'express'
import { getBill, listBills } from '../services/brands/brandBill.query'
import { cancelBill, deliver } from '../services/brands/brandBill.service'
import { addEntry, removeEntry } from '../services/brands/brandCloth.service'
import { cancelPayment, createPayment, listPayments, statement } from '../services/brands/brandPayment.service'
import * as exporter from '../services/export/brandReport.export'
import { brandSummary, clothReport, orderProfit, pendingWork } from '../services/reports/brand.report'
import { ApiError } from '../utils/ApiError'
import { brandReportSchema, type BrandClothInput, type BrandDeliverInput, type BrandPaymentInput } from '../validators/brandBill.validator'

// Brand delivery bills, money from brands, statements, the brand's cloth register and brand reports.

function readId(req: Request, key = 'id') {
  const id = Number(req.params[key])
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('Invalid id')
  return id
}
function query(req: Request) {
  const q = brandReportSchema.safeParse(req.query)
  if (!q.success) throw ApiError.badRequest(q.error.issues[0]?.message ?? 'Invalid filters')
  return { ...q.data, orderId: Number(req.query.orderId) > 0 ? Number(req.query.orderId) : undefined }
}
const user = (req: Request) => req.admin!.username
const reason = (req: Request) => (req.body as { reason: string }).reason

// /api/brand-orders/:id/deliver + /api/brand-bills
export const deliverOrder = async (req: Request, res: Response) => res.status(201).json({ success: true, item: await deliver(readId(req), req.body as BrandDeliverInput, user(req)) })
export const bills = async (req: Request, res: Response) => res.json({ success: true, items: await listBills(query(req)) })
export const billsExport = (req: Request, res: Response) => exporter.exportBills(res, query(req), user(req))
export const bill = async (req: Request, res: Response) => res.json({ success: true, item: await getBill(readId(req)) })
export const billCancel = async (req: Request, res: Response) => res.json({ success: true, item: await cancelBill(readId(req), reason(req), user(req)) })

// /api/brand-payments
export const payments = async (req: Request, res: Response) => res.json({ success: true, items: await listPayments(query(req)) })
export const paymentsExport = (req: Request, res: Response) => exporter.exportPayments(res, query(req), user(req))
export const paymentCreate = async (req: Request, res: Response) => res.status(201).json({ success: true, ...(await createPayment(req.body as BrandPaymentInput, user(req))) })
export async function paymentCancel(req: Request, res: Response) {
  await cancelPayment(readId(req), reason(req), user(req))
  res.json({ success: true })
}

// /api/brands/:id/statement
export const brandStatement = async (req: Request, res: Response) => res.json({ success: true, ...(await statement(readId(req))) })
export const brandStatementExport = (req: Request, res: Response) => exporter.exportStatement(res, readId(req), user(req))

// /api/brand-orders/:id/cloth
export const clothAdd = async (req: Request, res: Response) => res.status(201).json({ success: true, items: await addEntry(readId(req), req.body as BrandClothInput, user(req)) })
export const clothRemove = async (req: Request, res: Response) => res.json({ success: true, items: await removeEntry(readId(req), readId(req, 'entryId'), user(req)) })

// /api/reports/brands/:kind (summary | pending-work | profit | cloth) (+ /export)
const REPORTS = { summary: brandSummary, 'pending-work': pendingWork, profit: orderProfit, cloth: clothReport } as const
function kindOf(req: Request) {
  const kind = String(req.params.kind)
  if (!(kind in REPORTS)) throw ApiError.notFound('Unknown report')
  return kind as keyof typeof REPORTS
}
export const report = async (req: Request, res: Response) => res.json({ success: true, ...(await REPORTS[kindOf(req)](query(req))) })
export const reportExport = (req: Request, res: Response) => exporter.exportBrandReport(res, kindOf(req), query(req), user(req))
