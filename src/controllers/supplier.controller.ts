import type { Request, Response } from 'express'
import * as supplierService from '../services/supplier.service'
import { unpaidBills } from '../services/purchase/purchase.query'
import { ApiError } from '../utils/ApiError'
import { supplierListSchema, type SupplierInput } from '../validators/supplier.validator'

function readId(req: Request) {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('Invalid supplier id')
  return id
}
const user = (req: Request) => req.admin!.username

export async function list(req: Request, res: Response) {
  const q = supplierListSchema.safeParse(req.query)
  if (!q.success) throw ApiError.badRequest(q.error.issues[0]?.message ?? 'Invalid filters')
  res.json({ success: true, ...(await supplierService.list(q.data)) })
}

export async function getOne(req: Request, res: Response) {
  res.json({ success: true, item: await supplierService.getById(readId(req)) })
}

export async function create(req: Request, res: Response) {
  res.status(201).json({ success: true, item: await supplierService.create(req.body as SupplierInput, user(req)) })
}

export async function update(req: Request, res: Response) {
  res.json({ success: true, item: await supplierService.update(readId(req), req.body as SupplierInput, user(req)) })
}

export async function remove(req: Request, res: Response) {
  await supplierService.remove(readId(req), user(req))
  res.json({ success: true })
}

export async function statement(req: Request, res: Response) {
  res.json({ success: true, ...(await supplierService.statement(readId(req))) })
}

export async function unpaid(req: Request, res: Response) {
  res.json({ success: true, items: await unpaidBills(readId(req)) })
}
