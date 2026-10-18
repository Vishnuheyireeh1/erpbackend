import type { Request, Response } from 'express'
import type { ZodType } from 'zod'
import * as paymentService from '../services/purchase/payment.service'
import { listPurchases, getPurchase } from '../services/purchase/purchase.query'
import { markFreightPaid } from '../services/purchase/purchase.freight'
import * as purchaseService from '../services/purchase/purchase.service'
import * as returnService from '../services/purchase/purchaseReturn.service'
import { ApiError } from '../utils/ApiError'
import {
  cancelDocSchema,
  docListSchema,
  type FreightPaidInput,
  type PaymentInput,
  type PurchaseInput,
  type PurchaseReturnInput,
} from '../validators/purchase.validator'

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

// ---- Purchase bills ----
export async function list(req: Request, res: Response) {
  res.json({ success: true, ...(await listPurchases(parse(docListSchema, req.query))) })
}
export async function getOne(req: Request, res: Response) {
  res.json({ success: true, item: await getPurchase(readId(req)) })
}
export async function create(req: Request, res: Response) {
  res.status(201).json({ success: true, item: await purchaseService.createPurchase(req.body as PurchaseInput, user(req)) })
}
export async function cancel(req: Request, res: Response) {
  const { reason } = parse(cancelDocSchema, req.body)
  res.json({ success: true, item: await purchaseService.cancelPurchase(readId(req), reason, user(req)) })
}

// Freight paid to the transporter later.
export async function freightPaid(req: Request, res: Response) {
  res.json({ success: true, item: await markFreightPaid(readId(req), req.body as FreightPaidInput, user(req)) })
}

// ---- Supplier payments ----
export async function listPayments(req: Request, res: Response) {
  res.json({ success: true, ...(await paymentService.listPayments(parse(docListSchema, req.query))) })
}
export async function getPayment(req: Request, res: Response) {
  res.json({ success: true, item: await paymentService.getPayment(readId(req)) })
}
export async function createPayment(req: Request, res: Response) {
  res.status(201).json({ success: true, item: await paymentService.createPayment(req.body as PaymentInput, user(req)) })
}
export async function cancelPayment(req: Request, res: Response) {
  const { reason } = parse(cancelDocSchema, req.body)
  res.json({ success: true, item: await paymentService.cancelPayment(readId(req), reason, user(req)) })
}

// ---- Purchase returns (debit notes) ----
export async function getReturn(req: Request, res: Response) {
  res.json({ success: true, item: await returnService.getReturn(readId(req)) })
}
export async function createReturn(req: Request, res: Response) {
  res.status(201).json({ success: true, item: await returnService.createReturn(req.body as PurchaseReturnInput, user(req)) })
}
export async function cancelReturn(req: Request, res: Response) {
  const { reason } = parse(cancelDocSchema, req.body)
  res.json({ success: true, item: await returnService.cancelReturn(readId(req), reason, user(req)) })
}
