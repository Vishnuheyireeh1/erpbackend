import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import { amountInWords } from '../../utils/amountWords'
import { dateRange } from '../../utils/financialYear'
import type { BrandReportQuery } from '../../validators/brandBill.validator'

const r2 = (n: number) => Math.round(n * 100) / 100

// What is still due on each bill of a brand: money received clears the opening balance first, then the oldest bills.
export async function billDues(brandId: number) {
  const [brand, bills, paid] = await Promise.all([
    prisma.partnerBrand.findUniqueOrThrow({ where: { id: brandId }, select: { openingBalance: true } }),
    prisma.brandBill.findMany({ where: { brandId, status: 'POSTED' }, orderBy: [{ docDate: 'asc' }, { id: 'asc' }], select: { id: true, grandTotal: true } }),
    prisma.brandPayment.aggregate({ where: { brandId, status: 'POSTED' }, _sum: { amount: true } }),
  ])
  const opening = Number(brand.openingBalance)
  let pool = Number(paid._sum.amount ?? 0) + Math.max(0, -opening) - Math.max(0, opening)
  const due = new Map<number, number>()
  for (const b of bills) {
    const take = Math.max(0, Math.min(Number(b.grandTotal), pool))
    pool = r2(pool - take)
    due.set(b.id, r2(Number(b.grandTotal) - take))
  }
  return due
}

export async function getBill(id: number) {
  const bill = await prisma.brandBill.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { sortOrder: 'asc' } },
      order: { select: { id: true, docNo: true, theirOrderNo: true, labelNote: true } },
      brand: { select: { id: true, code: true, name: true, phone: true, address: true, city: true, gstin: true } },
    },
  })
  if (!bill) throw ApiError.notFound('Bill not found')
  const dueAmount = bill.status === 'POSTED' ? (await billDues(bill.brandId)).get(id) ?? 0 : 0
  return { ...bill, dueAmount, amountInWords: amountInWords(Number(bill.grandTotal)) }
}

// Bills of a brand / an order / a period, newest first, with what is still due on each.
export async function listBills(q: BrandReportQuery & { orderId?: number }) {
  const where: Prisma.BrandBillWhereInput = {}
  if (q.brandId) where.brandId = q.brandId
  if (q.orderId) where.orderId = q.orderId
  const range = dateRange(q.from, q.to)
  if (range) where.docDate = range
  const bills = await prisma.brandBill.findMany({
    where, orderBy: [{ docDate: 'desc' }, { id: 'desc' }], take: 500,
    include: { order: { select: { docNo: true, theirOrderNo: true } }, _count: { select: { items: true } } },
  })
  const dues = new Map<number, Map<number, number>>()
  for (const brandId of new Set(bills.map((b) => b.brandId))) dues.set(brandId, await billDues(brandId))
  return bills.map((b) => ({ ...b, dueAmount: b.status === 'POSTED' ? dues.get(b.brandId)?.get(b.id) ?? 0 : 0 }))
}
