import type { Request, Response } from 'express'
import * as brandService from '../services/brands/brand.service'
import { exportBrands } from '../services/export/brand.export'
import { ApiError } from '../utils/ApiError'
import { brandListSchema, type BrandInput } from '../validators/brand.validator'

// /api/brands — the other brands Sairandhri stitches for.

function readId(req: Request) {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('Invalid brand id')
  return id
}
function listQuery(req: Request) {
  const q = brandListSchema.safeParse(req.query)
  if (!q.success) throw ApiError.badRequest(q.error.issues[0]?.message ?? 'Invalid filters')
  return q.data
}
const user = (req: Request) => req.admin!.username

export const list = async (req: Request, res: Response) => res.json({ success: true, ...(await brandService.list(listQuery(req))) })
export const exportList = (req: Request, res: Response) => exportBrands(res, listQuery(req), user(req))
export const getOne = async (req: Request, res: Response) => res.json({ success: true, item: await brandService.getById(readId(req)) })

export async function create(req: Request, res: Response) {
  res.status(201).json({ success: true, item: await brandService.create(req.body as BrandInput, user(req)) })
}
export async function update(req: Request, res: Response) {
  res.json({ success: true, item: await brandService.update(readId(req), req.body as BrandInput, user(req)) })
}
export async function remove(req: Request, res: Response) {
  await brandService.remove(readId(req), user(req))
  res.json({ success: true })
}
