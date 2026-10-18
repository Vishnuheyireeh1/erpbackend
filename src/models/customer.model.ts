import { prisma } from '../config/prisma'
import type { Prisma } from '../generated/prisma/client'
import type { CustomerListQuery } from '../validators/sales.validator'

// Data access for customers and their money totals.

export function listWhere(q: Pick<CustomerListQuery, 'search' | 'status' | 'kind'>): Prisma.CustomerWhereInput {
  const where: Prisma.CustomerWhereInput = {}
  if (q.status !== 'all') where.isActive = q.status === 'active'
  if (q.kind === 'stitching') where.jobs = { some: { status: { not: 'CANCELLED' } } }
  if (q.kind === 'shop') where.jobs = { none: { status: { not: 'CANCELLED' } } }
  if (q.search) {
    const s = q.search
    where.OR = [
      { name: { contains: s, mode: 'insensitive' } },
      { phone: { contains: s.replace(/\s/g, '') } },
      { code: s.toUpperCase() },
      { gstin: s.toUpperCase() },
    ]
  }
  return where
}

// balance = opening + sales + jobs − received − returned + refunded   (+ = customer owes the shop)
export async function totals(ids: number[]) {
  const where = { customerId: { in: ids }, status: 'POSTED' as const }
  const [sales, jobs, receipts, returns] = await Promise.all([
    prisma.salesInvoice.groupBy({ by: ['customerId'], where, _sum: { grandTotal: true } }),
    prisma.stitchingJob.groupBy({ by: ['customerId'], where: { customerId: { in: ids }, status: { not: 'CANCELLED' } }, _sum: { grandTotal: true } }),
    prisma.customerReceipt.groupBy({ by: ['customerId'], where, _sum: { amount: true } }),
    prisma.salesReturn.groupBy({ by: ['customerId'], where, _sum: { grandTotal: true, refundAmount: true } }),
  ])
  const map = new Map<number, { billed: number; received: number; returned: number; refunded: number }>()
  for (const id of ids) map.set(id, { billed: 0, received: 0, returned: 0, refunded: 0 })
  sales.forEach((s) => s.customerId && (map.get(s.customerId)!.billed = Number(s._sum.grandTotal ?? 0)))
  jobs.forEach((j) => (map.get(j.customerId)!.billed += Number(j._sum.grandTotal ?? 0)))
  receipts.forEach((r) => r.customerId && (map.get(r.customerId)!.received = Number(r._sum.amount ?? 0)))
  returns.forEach((r) => {
    if (!r.customerId) return
    map.get(r.customerId)!.returned = Number(r._sum.grandTotal ?? 0)
    map.get(r.customerId)!.refunded = Number(r._sum.refundAmount ?? 0)
  })
  return map
}

export async function documentCount(id: number) {
  const [sales, receipts, measurements, jobs] = await Promise.all([
    prisma.salesInvoice.count({ where: { customerId: id } }),
    prisma.stitchingJob.count({ where: { customerId: id } }),
    prisma.customerReceipt.count({ where: { customerId: id } }),
    prisma.customerMeasurement.count({ where: { customerId: id } }),
  ])
  return sales + receipts + measurements + jobs
}

export async function statementRows(id: number) {
  const where = { customerId: id, status: 'POSTED' as const }
  const [sales, jobs, receipts, returns] = await Promise.all([
    prisma.salesInvoice.findMany({ where, select: { id: true, docNo: true, docDate: true, grandTotal: true, createdAt: true } }),
    prisma.stitchingJob.findMany({ where: { customerId: id, status: { not: 'CANCELLED' } }, select: { id: true, docNo: true, docDate: true, grandTotal: true, createdAt: true, status: true } }),
    prisma.customerReceipt.findMany({ where, select: { id: true, docNo: true, docDate: true, amount: true, createdAt: true, tenders: { select: { mode: true } } } }),
    prisma.salesReturn.findMany({ where, select: { id: true, docNo: true, docDate: true, grandTotal: true, refundAmount: true, refundMode: true, createdAt: true } }),
  ])
  return { sales, jobs, receipts, returns }
}
