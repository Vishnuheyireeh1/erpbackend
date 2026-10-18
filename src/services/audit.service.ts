import { prisma } from '../config/prisma'
import type { Prisma } from '../generated/prisma/client'

type Db = Prisma.TransactionClient | typeof prisma

export type AuditEntry = {
  actor: string
  action: string // "stock_document.post", "setting.update" …
  entity: string
  entityId: string | number
  summary: string
  details?: Prisma.InputJsonValue
}

// Append-only audit trail. Pass the transaction so the log commits / rolls back with the change.
export function audit(db: Db, entry: AuditEntry) {
  return db.auditLog.create({
    data: {
      actor: entry.actor,
      action: entry.action,
      entity: entry.entity,
      entityId: String(entry.entityId),
      summary: entry.summary.slice(0, 255),
      details: entry.details,
    },
  })
}

export function listFor(entity: string, entityId: string | number) {
  return prisma.auditLog.findMany({
    where: { entity, entityId: String(entityId) },
    orderBy: { id: 'desc' },
    take: 100,
  })
}
