import { byDate } from '../../utils/order'
import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import { dateRange } from '../../utils/financialYear'
import { gstStates } from '../../utils/gst'
import type { DocListQuery } from '../../validators/purchase.validator'

const r2 = (n: number) => Math.round(n * 100) / 100

// due = total − paid − returned (never below zero for display)
export function dueOf(b: { grandTotal: unknown; paidAmount: unknown; returnedAmount: unknown }) {
  return Math.max(0, r2(Number(b.grandTotal) - Number(b.paidAmount) - Number(b.returnedAmount)))
}

async function unpaidIds() {
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT id FROM purchase_invoices
    WHERE status = 'POSTED' AND grand_total - paid_amount - returned_amount > 0.004`
  return rows.map((r) => r.id)
}

// Same filters for the list screen and the Excel download.
export async function purchaseWhere(q: Omit<DocListQuery, 'page' | 'pageSize'>) {
  const where: Prisma.PurchaseInvoiceWhereInput = {}
  if (q.supplierId) where.supplierId = q.supplierId
  if (q.status === 'POSTED' || q.status === 'CANCELLED') where.status = q.status
  if (q.status === 'unpaid') where.id = { in: await unpaidIds() }
  const range = dateRange(q.from, q.to)
  if (range) where.docDate = range
  if (q.search) {
    const s = q.search
    where.OR = [
      { docNo: { contains: s, mode: 'insensitive' } },
      { supplierInvoiceNo: { contains: s, mode: 'insensitive' } },
      { supplier: { name: { contains: s, mode: 'insensitive' } } },
    ]
  }
  return where
}

export async function listPurchases(q: DocListQuery) {
  const where = await purchaseWhere(q)
  const [items, total] = await Promise.all([
    prisma.purchaseInvoice.findMany({
      where,
      orderBy: byDate(q.order),
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { supplier: { select: { id: true, name: true, code: true } }, _count: { select: { lines: true } } },
    }),
    prisma.purchaseInvoice.count({ where }),
  ])
  return { items: items.map((b) => ({ ...b, dueAmount: dueOf(b) })), total, page: q.page, pageSize: q.pageSize }
}

const itemSelect = {
  id: true,
  sku: true,
  barcode: true,
  size: { select: { name: true } },
  colour: { select: { name: true } },
  product: { select: { id: true, name: true, hsnCode: true, unit: { select: { code: true } } } },
} as const

export async function getPurchase(id: number) {
  const bill = await prisma.purchaseInvoice.findUnique({
    where: { id },
    include: {
      supplier: true,
      lines: { orderBy: { id: 'asc' }, include: { variant: { select: itemSelect } } },
      allocations: {
        where: { payment: { status: 'POSTED' } },
        include: { payment: { select: { id: true, docNo: true, docDate: true, mode: true, reference: true } } },
      },
      returns: { orderBy: { id: 'asc' }, select: { id: true, docNo: true, docDate: true, grandTotal: true, status: true } },
    },
  })
  if (!bill) throw ApiError.notFound('Purchase bill not found')
  return { ...bill, dueAmount: dueOf(bill), supplierStateName: gstStates[bill.supplier.stateCode] }
}

// Unpaid bills of one supplier, oldest first (payment screen + auto-allocation).
export async function unpaidBills(supplierId: number) {
  const ids = await unpaidIds()
  const bills = await prisma.purchaseInvoice.findMany({
    where: { supplierId, id: { in: ids } },
    orderBy: [{ docDate: 'asc' }, { id: 'asc' }],
    select: { id: true, docNo: true, docDate: true, supplierInvoiceNo: true, grandTotal: true, paidAmount: true, returnedAmount: true },
  })
  return bills.map((b) => ({ ...b, dueAmount: dueOf(b) }))
}
