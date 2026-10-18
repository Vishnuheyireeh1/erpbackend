import { prisma } from '../config/prisma'
import type { Prisma } from '../generated/prisma/client'
import type { SupplierListQuery } from '../validators/supplier.validator'

// Data access for suppliers and their money totals.

export function listWhere(q: Pick<SupplierListQuery, 'search' | 'status'>): Prisma.SupplierWhereInput {
  const where: Prisma.SupplierWhereInput = {}
  if (q.status !== 'all') where.isActive = q.status === 'active'
  if (q.search) {
    const s = q.search
    where.OR = [
      { name: { contains: s, mode: 'insensitive' } },
      { code: s.toUpperCase() },
      { gstin: s.toUpperCase() },
      { phone: { contains: s } },
    ]
  }
  return where
}

export function findMany(where: Prisma.SupplierWhereInput) {
  return prisma.supplier.findMany({ where, orderBy: { name: 'asc' } })
}

export function findById(id: number) {
  return prisma.supplier.findUnique({ where: { id } })
}

// Posted bill / payment / return totals per supplier (balance = opening + bills − payments − returns).
export async function totals(ids: number[]) {
  const where = { supplierId: { in: ids }, status: 'POSTED' as const }
  const [bills, payments, returns] = await Promise.all([
    prisma.purchaseInvoice.groupBy({ by: ['supplierId'], where, _sum: { grandTotal: true } }),
    prisma.supplierPayment.groupBy({ by: ['supplierId'], where, _sum: { amount: true } }),
    prisma.purchaseReturn.groupBy({ by: ['supplierId'], where, _sum: { grandTotal: true } }),
  ])
  const map = new Map<number, { billed: number; paid: number; returned: number }>()
  for (const id of ids) map.set(id, { billed: 0, paid: 0, returned: 0 })
  bills.forEach((b) => (map.get(b.supplierId)!.billed = Number(b._sum.grandTotal ?? 0)))
  payments.forEach((p) => (map.get(p.supplierId)!.paid = Number(p._sum.amount ?? 0)))
  returns.forEach((r) => (map.get(r.supplierId)!.returned = Number(r._sum.grandTotal ?? 0)))
  return map
}

export async function documentCount(id: number) {
  const [bills, payments] = await Promise.all([
    prisma.purchaseInvoice.count({ where: { supplierId: id } }),
    prisma.supplierPayment.count({ where: { supplierId: id } }),
  ])
  return bills + payments
}

// Everything that changed this supplier's balance, oldest first (cancelled documents excluded).
export async function statementRows(id: number) {
  const where = { supplierId: id, status: 'POSTED' as const }
  const [bills, payments, returns] = await Promise.all([
    prisma.purchaseInvoice.findMany({ where, select: { id: true, docNo: true, docDate: true, supplierInvoiceNo: true, grandTotal: true, createdAt: true } }),
    prisma.supplierPayment.findMany({ where, select: { id: true, docNo: true, docDate: true, mode: true, reference: true, amount: true, createdAt: true } }),
    prisma.purchaseReturn.findMany({ where, select: { id: true, docNo: true, docDate: true, grandTotal: true, createdAt: true } }),
  ])
  return { bills, payments, returns }
}
