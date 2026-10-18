import type { Request, Response } from 'express'
import * as material from '../services/brands/brandOrder.material'
import { getOrder, listOrders } from '../services/brands/brandOrder.query'
import * as orders from '../services/brands/brandOrder.service'
import { exportBrandOrders } from '../services/export/brand.export'
import { ApiError } from '../utils/ApiError'
import { brandOrderListSchema, type BrandOrderCreateInput, type BrandOrderUpdateInput } from '../validators/brandOrder.validator'

// /api/brand-orders — orders from other brands, stitched with their label.

function readId(req: Request, key = 'id') {
  const id = Number(req.params[key])
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('Invalid id')
  return id
}
function listQuery(req: Request) {
  const q = brandOrderListSchema.safeParse(req.query)
  if (!q.success) throw ApiError.badRequest(q.error.issues[0]?.message ?? 'Invalid filters')
  return q.data
}
const user = (req: Request) => req.admin!.username

export const list = async (req: Request, res: Response) => res.json({ success: true, ...(await listOrders(listQuery(req))) })
export const exportList = (req: Request, res: Response) => exportBrandOrders(res, listQuery(req), user(req))
export const getOne = async (req: Request, res: Response) => res.json({ success: true, item: await getOrder(readId(req)) })

export async function create(req: Request, res: Response) {
  res.status(201).json({ success: true, item: await orders.createOrder(req.body as BrandOrderCreateInput, user(req)) })
}
export async function update(req: Request, res: Response) {
  res.json({ success: true, item: await orders.updateOrder(readId(req), req.body as BrandOrderUpdateInput, user(req)) })
}
export async function stage(req: Request, res: Response) {
  const b = req.body as { itemIds: number[]; stage: 'IN_WORK' | 'READY' }
  res.json({ success: true, item: await orders.setStage(readId(req), b.itemIds, b.stage, user(req)) })
}
export async function cancel(req: Request, res: Response) {
  res.json({ success: true, item: await orders.cancelOrder(readId(req), (req.body as { reason: string }).reason, user(req)) })
}
export async function addMaterials(req: Request, res: Response) {
  const b = req.body as { itemId: number; lines: Parameters<typeof material.addMaterials>[2] }
  await material.addMaterials(readId(req), b.itemId, b.lines, user(req))
  res.json({ success: true, item: await getOrder(readId(req)) })
}
export async function removeMaterial(req: Request, res: Response) {
  await material.removeMaterial(readId(req), readId(req, 'materialId'), user(req))
  res.json({ success: true, item: await getOrder(readId(req)) })
}
