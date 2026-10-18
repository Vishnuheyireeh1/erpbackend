import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import { dateRange, nextDocNo, toDocDate } from '../../utils/financialYear'
import type { BrandPaymentInput, BrandReportQuery } from '../../validators/brandBill.validator'
import { audit } from '../audit.service'
import { getById } from './brand.service'

// Money received from a brand (BRP/…): cash / UPI / bank … — reduces what the brand owes (oldest bills first).

const r2 = (n: number) => Math.round(n * 100) / 100

export async function createPayment(input: BrandPaymentInput, user: string) {
  const { date, isFuture } = toDocDate(input.docDate)
  if (isFuture) throw ApiError.badRequest("Date can't be in the future")
  const brand = await prisma.partnerBrand.findUnique({ where: { id: input.brandId } })
  if (!brand) throw ApiError.badRequest('Selected brand no longer exists')
  const payment = await prisma.$transaction(async (tx) => {
    const docNo = await nextDocNo(tx, 'BRP', date)
    const p = await tx.brandPayment.create({ data: { docNo, brandId: brand.id, docDate: date, amount: input.amount, mode: input.mode, reference: input.reference, notes: input.notes, createdBy: user } })
    await audit(tx, { actor: user, action: 'brandPayment.create', entity: 'brandPayment', entityId: p.id, summary: `${docNo} — ₹${input.amount} from ${brand.name} (${input.mode}${input.reference ? ` ${input.reference}` : ''})` })
    return p
  })
  return { payment, brand: await getById(brand.id) }
}

export async function cancelPayment(id: number, reason: string, user: string) {
  const p = await prisma.brandPayment.findUnique({ where: { id }, include: { brand: { select: { name: true } } } })
  if (!p) throw ApiError.notFound('Payment not found')
  if (p.status === 'CANCELLED') throw ApiError.conflict(`${p.docNo} is already cancelled`)
  await prisma.$transaction(async (tx) => {
    const n = await tx.brandPayment.updateMany({ where: { id, status: 'POSTED' }, data: { status: 'CANCELLED', cancelledBy: user, cancelledAt: new Date(), cancelReason: reason } })
    if (!n.count) throw ApiError.conflict(`${p.docNo} is already cancelled`)
    await audit(tx, { actor: user, action: 'brandPayment.cancel', entity: 'brandPayment', entityId: id, summary: `${p.docNo} cancelled (₹${p.amount} from ${p.brand.name}) — ${reason}` })
  })
}

export function listPayments(q: BrandReportQuery) {
  const where: Prisma.BrandPaymentWhereInput = {}
  if (q.brandId) where.brandId = q.brandId
  const range = dateRange(q.from, q.to)
  if (range) where.docDate = range
  return prisma.brandPayment.findMany({ where, orderBy: [{ docDate: 'desc' }, { id: 'desc' }], take: 500, include: { brand: { select: { name: true } } } })
}

// Brand statement: opening → bills (+) / money received (−), by date, with the running balance (+ = brand owes us).
export async function statement(brandId: number) {
  const brand = await getById(brandId)
  const [bills, payments] = await Promise.all([
    prisma.brandBill.findMany({ where: { brandId, status: 'POSTED' }, include: { order: { select: { docNo: true, theirOrderNo: true } } } }),
    prisma.brandPayment.findMany({ where: { brandId, status: 'POSTED' } }),
  ])
  type Row = { date: Date; createdAt: Date; type: 'BILL' | 'PAYMENT'; id: number; docNo: string; detail: string; billed: number; received: number }
  const rows: Row[] = [
    ...bills.map((b) => ({ date: b.docDate, createdAt: b.createdAt, type: 'BILL' as const, id: b.id, docNo: b.docNo, detail: `Delivery bill · ${b.order.docNo}${b.order.theirOrderNo ? ` (their ${b.order.theirOrderNo})` : ''}`, billed: Number(b.grandTotal), received: 0 })),
    ...payments.map((p) => ({ date: p.docDate, createdAt: p.createdAt, type: 'PAYMENT' as const, id: p.id, docNo: p.docNo, detail: `Received by ${p.mode}${p.reference ? ` · ${p.reference}` : ''}`, billed: 0, received: Number(p.amount) })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime())
  let balance = Number(brand.openingBalance)
  const withBalance = rows.map((r) => ({ ...r, balance: (balance = r2(balance + r.billed - r.received)) }))
  return { brand, opening: Number(brand.openingBalance), rows: withBalance, closing: r2(balance) }
}
