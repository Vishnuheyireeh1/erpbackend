import type { Request, Response } from 'express'
import { activityQuerySchema, exportActivity, listActivity } from '../services/system/activity.service'
import { backupFile, createBackup, listBackups } from '../services/system/backup.service'
import { checklist } from '../services/system/golive.service'
import { listPrinters, printBill } from '../services/system/rawPrint'
import { ApiError } from '../utils/ApiError'

const user = (req: Request) => req.admin!.username
function query(req: Request) {
  const r = activityQuerySchema.safeParse(req.query)
  if (!r.success) throw ApiError.badRequest(r.error.issues[0]?.message ?? 'Invalid filter')
  return r.data
}

// /api/system/* — backups, go-live checklist, activity log.
export const getBackups = async (_req: Request, res: Response) => res.json({ success: true, ...(await listBackups()) })
export async function backupNow(req: Request, res: Response) {
  const done = await createBackup('manual', user(req))
  res.status(201).json({ success: true, ...done })
}
export const downloadBackup = (req: Request, res: Response) => res.download(backupFile(String(req.params.name)))
export const getChecklist = async (_req: Request, res: Response) => res.json({ success: true, ...(await checklist()) })
export const getActivity = async (req: Request, res: Response) => res.json({ success: true, ...(await listActivity(query(req))) })
export const activityExport = (req: Request, res: Response) => exportActivity(res, query(req), user(req))

// Bill printing straight to the dot-matrix printer on this PC.
export const getPrinters = async (_req: Request, res: Response) => res.json({ success: true, items: await listPrinters() })
export async function printText(req: Request, res: Response) {
  const text = typeof req.body?.text === 'string' ? req.body.text : ''
  if (!text.trim() || text.length > 50_000) throw ApiError.badRequest('Nothing to print')
  const printer = typeof req.body?.printer === 'string' ? req.body.printer.slice(0, 200) : undefined
  const copies = Number.isInteger(req.body?.copies) ? Number(req.body.copies) : 1
  await printBill(text, { printer, copies })
  res.json({ success: true })
}
