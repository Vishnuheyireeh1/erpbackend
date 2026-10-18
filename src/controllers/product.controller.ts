import type { Request, Response } from 'express'
import * as productService from '../services/product.service'
import { ApiError } from '../utils/ApiError'
import { productListSchema, type ProductInput } from '../validators/product.validator'

function readId(req: Request) {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('Invalid product id')
  return id
}

export async function list(req: Request, res: Response) {
  const parsed = productListSchema.safeParse(req.query)
  if (!parsed.success) throw ApiError.badRequest(parsed.error.issues[0]?.message ?? 'Invalid filters')
  res.json({ success: true, ...(await productService.list(parsed.data)) })
}

export async function getOne(req: Request, res: Response) {
  res.json({ success: true, item: await productService.getById(readId(req)) })
}

export async function lookup(req: Request, res: Response) {
  const code = typeof req.query.code === 'string' ? req.query.code.slice(0, 60) : ''
  res.json({ success: true, item: await productService.lookup(code) })
}

export async function create(req: Request, res: Response) {
  const item = await productService.createProduct(req.body as ProductInput)
  res.status(201).json({ success: true, item })
}

export async function update(req: Request, res: Response) {
  const item = await productService.updateProduct(readId(req), req.body as ProductInput)
  res.json({ success: true, item })
}

export async function remove(req: Request, res: Response) {
  await productService.remove(readId(req))
  res.json({ success: true })
}

export async function uploadImage(req: Request, res: Response) {
  const imagePath = await productService.setImage(readId(req), req.file?.buffer)
  res.json({ success: true, imagePath })
}

export async function removeImage(req: Request, res: Response) {
  await productService.removeImage(readId(req))
  res.json({ success: true })
}
