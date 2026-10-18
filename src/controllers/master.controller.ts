import type { Request, Response } from 'express'
import * as masterService from '../services/master.service'
import { ApiError } from '../utils/ApiError'
import {
  listQuerySchema,
  masterKeys,
  masterSchemas,
  type MasterKey,
} from '../validators/master.validator'

// URL: /api/masters/:master/:id? — :master is one of masterKeys.
function readKey(req: Request): MasterKey {
  const key = req.params.master as MasterKey
  if (!masterKeys.includes(key)) throw ApiError.notFound(`Unknown master: ${req.params.master}`)
  return key
}

function readId(req: Request) {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('Invalid id')
  return id
}

function readQuery(req: Request) {
  const parsed = listQuerySchema.safeParse(req.query)
  if (!parsed.success) throw ApiError.badRequest(parsed.error.issues[0]?.message ?? 'Invalid filters')
  return parsed.data
}

function readBody(key: MasterKey, req: Request) {
  const parsed = masterSchemas[key].safeParse(req.body ?? {})
  if (!parsed.success) throw ApiError.badRequest(parsed.error.issues[0]?.message ?? 'Invalid input')
  return parsed.data as Record<string, unknown>
}

export async function list(req: Request, res: Response) {
  const key = readKey(req)
  res.json({ success: true, ...(await masterService.list(key, readQuery(req))) })
}

export async function options(req: Request, res: Response) {
  const key = readKey(req)
  res.json({ success: true, items: await masterService.options(key, readQuery(req)) })
}

export async function create(req: Request, res: Response) {
  const key = readKey(req)
  const item = await masterService.create(key, readBody(key, req))
  res.status(201).json({ success: true, item })
}

export async function update(req: Request, res: Response) {
  const key = readKey(req)
  const item = await masterService.update(key, readId(req), readBody(key, req))
  res.json({ success: true, item })
}

export async function remove(req: Request, res: Response) {
  const key = readKey(req)
  await masterService.remove(key, readId(req))
  res.json({ success: true })
}
