import type { Request, Response } from 'express'
import type { ZodType } from 'zod'
import * as exporter from '../services/export/workshop.export'
import * as costCategoryService from '../services/workshop/costCategory.service'
import * as garmentService from '../services/workshop/garment.service'
import * as measurementService from '../services/workshop/measurement.service'
import * as tailorExport from '../services/export/tailor.export'
import * as tailorService from '../services/workshop/tailor.service'
import { statement } from '../services/workshop/tailor.statement'
import * as payments from '../services/workshop/tailorPayment.service'
import { cancelDocSchema, docListSchema } from '../validators/purchase.validator'
import { ApiError } from '../utils/ApiError'
import { tailorListSchema, type CostCategoryInput, type GarmentInput, type MeasurementInput, type TailorPaymentInput } from '../validators/workshop.validator'

function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data ?? {})
  if (!r.success) throw ApiError.badRequest(r.error.issues[0]?.message ?? 'Invalid input')
  return r.data
}
function readId(req: Request, key = 'id') {
  const id = Number(req.params[key])
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('Invalid id')
  return id
}
const user = (req: Request) => req.admin!.username

// ---- Tailors ----
export const listTailors = async (req: Request, res: Response) => res.json({ success: true, ...(await tailorService.list(parse(tailorListSchema, req.query))) })
export const tailorOptions = async (_req: Request, res: Response) => res.json({ success: true, items: await tailorService.options() })
export const getTailor = async (req: Request, res: Response) => res.json({ success: true, item: await tailorService.getById(readId(req)) })
export const exportTailors = (req: Request, res: Response) => exporter.exportTailors(res, parse(tailorListSchema, req.query), user(req))
export const tailorStatement = async (req: Request, res: Response) => res.json({ success: true, ...(await statement(readId(req))) })
export const tailorStatementExport = (req: Request, res: Response) => tailorExport.exportTailorStatement(res, readId(req), user(req))

// ---- Tailor payments ----
const tailorFilter = (req: Request) => (Number(req.query.tailorId) > 0 ? Number(req.query.tailorId) : undefined)
export const listPayments = async (req: Request, res: Response) => res.json({ success: true, ...(await payments.listPayments({ ...parse(docListSchema, req.query), tailorId: tailorFilter(req) })) })
export const exportPayments = (req: Request, res: Response) => tailorExport.exportTailorPayments(res, { ...parse(docListSchema, req.query), tailorId: tailorFilter(req) }, user(req))
export const getPayment = async (req: Request, res: Response) => res.json({ success: true, item: await payments.getPayment(readId(req)) })
export const createPayment = async (req: Request, res: Response) => res.status(201).json({ success: true, item: await payments.createPayment(req.body as TailorPaymentInput, user(req)) })
export const cancelPayment = async (req: Request, res: Response) => res.json({ success: true, item: await payments.cancelPayment(readId(req), parse(cancelDocSchema, req.body).reason, user(req)) })

// ---- Job cost types ----
export const listCostCategories = async (_req: Request, res: Response) => res.json({ success: true, items: await costCategoryService.list() })
export const createCostCategory = async (req: Request, res: Response) => res.status(201).json({ success: true, item: await costCategoryService.create(req.body as CostCategoryInput, user(req)) })
export const updateCostCategory = async (req: Request, res: Response) => res.json({ success: true, item: await costCategoryService.update(readId(req), req.body as CostCategoryInput, user(req)) })
export async function removeCostCategory(req: Request, res: Response) {
  await costCategoryService.remove(readId(req), user(req))
  res.json({ success: true })
}

// ---- Garment types ----
export const listGarments = async (req: Request, res: Response) => res.json({ success: true, items: await garmentService.list(req.query.active !== '1') })
export const createGarment = async (req: Request, res: Response) => res.status(201).json({ success: true, item: await garmentService.create(req.body as GarmentInput, user(req)) })
export const updateGarment = async (req: Request, res: Response) => res.json({ success: true, item: await garmentService.update(readId(req), req.body as GarmentInput, user(req)) })
export async function removeGarment(req: Request, res: Response) {
  await garmentService.remove(readId(req), user(req))
  res.json({ success: true })
}
export const exportGarments = (req: Request, res: Response) => exporter.exportGarments(res, user(req))

// ---- Customer measurements (/customers/:id/measurements) ----
export const listMeasurements = async (req: Request, res: Response) => res.json({ success: true, items: await measurementService.listForCustomer(readId(req)) })
export const createMeasurement = async (req: Request, res: Response) =>
  res.status(201).json({ success: true, item: await measurementService.create(readId(req), req.body as MeasurementInput, user(req)) })
export async function removeMeasurement(req: Request, res: Response) {
  await measurementService.remove(readId(req), readId(req, 'mid'), user(req))
  res.json({ success: true })
}
