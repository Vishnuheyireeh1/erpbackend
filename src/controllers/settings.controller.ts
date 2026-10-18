import type { Request, Response } from 'express'
import * as numberingService from '../services/numbering.service'
import * as settingsService from '../services/settings.service'
import { ApiError } from '../utils/ApiError'

export async function getAll(_req: Request, res: Response) {
  res.json({ success: true, settings: await settingsService.getAll() })
}

// PUT /settings  { "inventory.allowNegativeStock": true }
export async function update(req: Request, res: Response) {
  const body = req.body
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length === 0) {
    throw ApiError.badRequest('Nothing to update')
  }
  const settings = await settingsService.update(body as Record<string, unknown>, req.admin!.username)
  res.json({ success: true, settings })
}

// Document numbering — "continue from the old bill book".
export async function numbering(_req: Request, res: Response) {
  res.json({ success: true, ...(await numberingService.list()) })
}
export async function setNumbering(req: Request, res: Response) {
  const { key, nextNumber } = (req.body ?? {}) as { key?: unknown; nextNumber?: unknown }
  if (typeof key !== 'string' || !key) throw ApiError.badRequest('Choose a document type')
  res.json({ success: true, ...(await numberingService.setNext(key, Number(nextNumber), req.admin!.username)) })
}
// Letters / layout / digits of one document type.
export async function saveNumberingFormat(req: Request, res: Response) {
  const { key, ...format } = (req.body ?? {}) as { key?: unknown; prefix?: unknown; layout?: unknown; digits?: unknown }
  if (typeof key !== 'string' || !key) throw ApiError.badRequest('Choose a document type')
  res.json({ success: true, ...(await numberingService.saveFormat(key, format, req.admin!.username)) })
}
