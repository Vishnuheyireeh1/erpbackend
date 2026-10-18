import type { Request, Response } from 'express'
import type { ZodType } from 'zod'
import * as stockModel from '../models/stock.model'
import * as openingImport from '../services/inventory/opening.import'
import * as docService from '../services/inventory/stockDocument.service'
import { ApiError } from '../utils/ApiError'
import {
  cancelSchema,
  documentListSchema,
  stockListSchema,
  type AdjustmentInput,
  type OpeningInput,
} from '../validators/inventory.validator'

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

// GET /stock
export async function list(req: Request, res: Response) {
  res.json({ success: true, ...(await stockModel.list(parse(stockListSchema, req.query))) })
}

// GET /stock/summary
export async function summary(_req: Request, res: Response) {
  res.json({ success: true, ...(await stockModel.summary()) })
}

// GET /stock/items/:id/ledger?page=
export async function ledger(req: Request, res: Response) {
  const id = readId(req)
  const item = await stockModel.findVariant(id)
  if (!item) throw ApiError.notFound('Item not found')
  const page = Math.max(1, Number(req.query.page) || 1)
  res.json({ success: true, item, ...(await stockModel.ledger(id, page, 30, req.query.order === 'oldest' ? 'asc' : 'desc')) })
}

// GET /stock/documents
export async function listDocuments(req: Request, res: Response) {
  res.json({ success: true, ...(await docService.listDocuments(parse(documentListSchema, req.query))) })
}

export async function getDocument(req: Request, res: Response) {
  res.json({ success: true, item: await docService.getDocument(readId(req)) })
}

export async function createOpening(req: Request, res: Response) {
  const item = await docService.createOpening(req.body as OpeningInput, user(req))
  res.status(201).json({ success: true, item })
}

export async function createAdjustment(req: Request, res: Response) {
  const item = await docService.createAdjustment(req.body as AdjustmentInput, user(req))
  res.status(201).json({ success: true, item })
}

export async function cancelDocument(req: Request, res: Response) {
  const { reason } = parse(cancelSchema, req.body)
  res.json({ success: true, item: await docService.cancelDocument(readId(req), reason, user(req)) })
}


// ---- Opening stock from Excel ----

export async function openingTemplate(_req: Request, res: Response) {
  const buf = await openingImport.buildOpeningTemplate()
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="sairandhri-opening-stock.xlsx"')
  res.send(buf)
}

export async function openingCheck(req: Request, res: Response) {
  res.json({ success: true, ...(await openingImport.checkOpeningFile(req.file)) })
}

export async function openingImportFile(req: Request, res: Response) {
  const docDate = typeof req.body?.docDate === 'string' && req.body.docDate ? req.body.docDate : undefined
  if (docDate && !/^\d{4}-\d{2}-\d{2}$/.test(docDate)) throw ApiError.badRequest('Date must look like 2026-10-05')
  const result = await openingImport.importOpeningFile(req.file, docDate, user(req))
  res.status(result.imported ? 201 : 422).json({ success: result.imported, ...result })
}
