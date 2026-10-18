import type { Response } from 'express'
import { z } from 'zod'
import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { inBatches, sendExcel, filterText, type ExcelColumn } from '../../utils/excel'

// Settings → "Activity log": every saved change (bills, payments, cancels, settings, backups …), newest first.

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const activityQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  entity: z.string().trim().max(40).optional(),
  from: date.optional(),
  to: date.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})
export type ActivityQuery = z.infer<typeof activityQuerySchema>

// IST day boundaries → UTC instants.
const istStart = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 5.5 * 3600_000)

function where(q: Omit<ActivityQuery, 'page' | 'pageSize'>) {
  const w: Prisma.AuditLogWhereInput = {}
  if (q.entity) w.entity = q.entity
  if (q.from || q.to) w.at = { ...(q.from ? { gte: istStart(q.from) } : {}), ...(q.to ? { lt: new Date(istStart(q.to).getTime() + 86_400_000) } : {}) }
  if (q.search) {
    w.OR = [
      { summary: { contains: q.search, mode: 'insensitive' } },
      { action: { contains: q.search, mode: 'insensitive' } },
      { actor: { contains: q.search, mode: 'insensitive' } },
    ]
  }
  return w
}

const shape = <T extends { id: bigint }>(r: T) => ({ ...r, id: Number(r.id) })

export async function listActivity(q: ActivityQuery) {
  const w = where(q)
  const [items, total, entities] = await Promise.all([
    prisma.auditLog.findMany({ where: w, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, select: { id: true, at: true, actor: true, action: true, entity: true, entityId: true, summary: true } }),
    prisma.auditLog.count({ where: w }),
    prisma.auditLog.groupBy({ by: ['entity'], _count: { _all: true }, orderBy: { entity: 'asc' } }),
  ])
  return { items: items.map(shape), total, page: q.page, pageSize: q.pageSize, entities: entities.map((e) => e.entity) }
}

export async function exportActivity(res: Response, q: Omit<ActivityQuery, 'page' | 'pageSize'>, user: string) {
  const w = where(q)
  const fetch = (skip: number, take: number) => prisma.auditLog.findMany({ where: w, orderBy: { id: 'asc' }, skip, take })
  type Row = Awaited<ReturnType<typeof fetch>>[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'When (IST)', value: (r) => new Date(r.at.getTime() + 5.5 * 3600_000).toISOString().slice(0, 16).replace('T', ' '), width: 18 },
    { header: 'Who', value: (r) => r.actor, width: 16 },
    { header: 'What', value: (r) => r.action, width: 24 },
    { header: 'Record', value: (r) => `${r.entity} ${r.entityId}`, width: 22 },
    { header: 'Details', value: (r) => r.summary, width: 70 },
  ]
  const filters = filterText([['Search', q.search], ['Type', q.entity], ['From', q.from], ['To', q.to]])
  return sendExcel(res, { fileName: 'activity-log', title: 'Activity log', filters, columns, rows: inBatches(fetch), user })
}
