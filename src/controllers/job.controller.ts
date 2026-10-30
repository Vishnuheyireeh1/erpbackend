import type { Request, Response } from 'express'
import type { ZodType } from 'zod'
import * as costs from '../services/jobs/job.costs'
import { setWorkers as assignWorkers } from '../services/jobs/job.workers'
import * as material from '../services/jobs/job.material'
import { jobPdf } from '../services/jobs/job.pdf'
import { chargeKinds as usedChargeKinds, getJob, listJobs } from '../services/jobs/job.query'
import * as jobService from '../services/jobs/job.service'
import * as jobStatus from '../services/jobs/job.status'
import { exportJobs } from '../services/export/job.export'
import { ApiError } from '../utils/ApiError'
import { cancelDocSchema } from '../validators/purchase.validator'
import * as bookNo from '../services/sales/bookNo.service'
import { jobListSchema, type JobAddItemsInput, type JobCostEntryInput, type JobWorkersInput, type JobCreateInput, type JobDeliverInput, type JobUpdateInput } from '../validators/job.validator'

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
const ok = (res: Response, item: unknown, status = 200) => res.status(status).json({ success: true, item })

export const list = async (req: Request, res: Response) => res.json({ success: true, ...(await listJobs(parse(jobListSchema, req.query))) })
export const exportList = (req: Request, res: Response) => exportJobs(res, parse(jobListSchema, req.query), user(req))
export async function pdf(req: Request, res: Response) {
  const { buffer, fileName } = await jobPdf(readId(req))
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="${fileName}"`)
  res.send(buffer)
}
export const getOne = async (req: Request, res: Response) => ok(res, await getJob(readId(req)))
export const create = async (req: Request, res: Response) => ok(res, await jobService.createJob(req.body as JobCreateInput, user(req)), 201)
export const update = async (req: Request, res: Response) => ok(res, await jobService.updateJob(readId(req), req.body as JobUpdateInput, user(req)))

export async function setStatus(req: Request, res: Response) {
  const { status, note } = req.body as { status: Parameters<typeof jobStatus.setStatus>[1]; note: string | null }
  ok(res, await jobStatus.setStatus(readId(req), status, note, user(req)))
}
export const deliver = async (req: Request, res: Response) => ok(res, await jobStatus.deliverJob(readId(req), req.body as JobDeliverInput, user(req)))
export const cancel = async (req: Request, res: Response) => ok(res, await jobStatus.cancelJob(readId(req), parse(cancelDocSchema, req.body).reason, user(req)))

export const addItems = async (req: Request, res: Response) => ok(res, await material.addItems(readId(req), req.body as JobAddItemsInput, user(req)), 201)
export const removeItem = async (req: Request, res: Response) => ok(res, await material.removeItem(readId(req), readId(req, 'mid'), user(req)))

export const addCost = async (req: Request, res: Response) => ok(res, await costs.addCostEntry(readId(req), req.body as JobCostEntryInput, user(req)), 201)
export const updateCost = async (req: Request, res: Response) => ok(res, await costs.updateCostEntry(readId(req), readId(req, 'eid'), req.body as JobCostEntryInput, user(req)))
export const setWorkers = async (req: Request, res: Response) => ok(res, await assignWorkers(readId(req), req.body as JobWorkersInput, user(req)))
export const removeCost = async (req: Request, res: Response) => ok(res, await costs.removeCostEntry(readId(req), readId(req, 'eid'), user(req)))

export async function measuredBy(req: Request, res: Response) {
  const raw = (req.body as { staffId?: unknown }).staffId
  const staffId = raw === null || raw === '' || raw === undefined ? null : Number(raw)
  if (staffId !== null && (!Number.isInteger(staffId) || staffId <= 0)) throw ApiError.badRequest('Choose the staff member')
  res.json({ success: true, item: await material.setMeasuredBy(readId(req), readId(req, 'itemId'), staffId, user(req)) })
}
export async function uploadPhoto(req: Request, res: Response) {
  if (!req.file) throw ApiError.badRequest('Choose a photo')
  res.json({ success: true, imagePath: await material.setItemPhoto(readId(req), readId(req, 'itemId'), req.file.buffer, user(req)) })
}
export async function removePhoto(req: Request, res: Response) {
  await material.setItemPhoto(readId(req), readId(req, 'itemId'), undefined, user(req))
  res.json({ success: true })
}

// Paper order book number — add / correct any time.
export const setBookNo = async (req: Request, res: Response) => res.json({ success: true, ...(await bookNo.setJobBookNo(readId(req), (req.body as { bookNo: string | null }).bookNo, user(req))) })

export async function chargeKinds(_req: Request, res: Response) {
  res.json({ success: true, items: await usedChargeKinds() })
}
