import type { Request, Response } from 'express'
import { exportProduction } from '../services/export/production.export'
import { getProduction, listProduction } from '../services/production/production.query'
import { cancelProduction, createProduction } from '../services/production/production.service'
import { ApiError } from '../utils/ApiError'
import { cancelDocSchema } from '../validators/purchase.validator'
import { productionListSchema, type ProductionInput } from '../validators/production.validator'

function readId(req: Request) {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('Invalid id')
  return id
}
function query(req: Request) {
  const r = productionListSchema.safeParse(req.query)
  if (!r.success) throw ApiError.badRequest(r.error.issues[0]?.message ?? 'Invalid filter')
  return r.data
}
const user = (req: Request) => req.admin!.username

// /api/production
export const list = async (req: Request, res: Response) => res.json({ success: true, ...(await listProduction(query(req))) })
export const exportList = (req: Request, res: Response) => exportProduction(res, query(req), user(req))
export const getOne = async (req: Request, res: Response) => res.json({ success: true, item: await getProduction(readId(req)) })
export const create = async (req: Request, res: Response) => res.status(201).json({ success: true, item: await createProduction(req.body as ProductionInput, user(req)) })
export async function cancel(req: Request, res: Response) {
  const r = cancelDocSchema.safeParse(req.body ?? {})
  if (!r.success) throw ApiError.badRequest(r.error.issues[0]?.message ?? 'Enter the reason')
  res.json({ success: true, item: await cancelProduction(readId(req), r.data.reason, user(req)) })
}
