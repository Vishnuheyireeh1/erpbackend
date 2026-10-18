import { byDate } from '../../utils/order'
import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import { dateRange, nextDocNo, toDocDate } from '../../utils/financialYear'
import type { DocListQuery } from '../../validators/purchase.validator'
import type { TailorPaymentInput } from '../../validators/workshop.validator'
import { audit } from '../audit.service'
import { assertNotOnPayslip } from '../staff/payroll.service'

// Money paid to per-piece tailors (TP/…). Salaried tailors are paid through payroll later.

export async function createPayment(input: TailorPaymentInput, user: string) {
  const { date, isFuture } = toDocDate(input.docDate)
  if (isFuture) throw ApiError.badRequest("Date can't be in the future")
  const tailor = await prisma.tailor.findUnique({ where: { id: input.tailorId } })
  if (!tailor) throw ApiError.badRequest('Tailor not found')
  if (tailor.payType !== 'PIECE') throw ApiError.badRequest(`${tailor.name} is salaried — salary is paid through payroll`)
  const id = await prisma.$transaction(async (tx) => {
    const docNo = await nextDocNo(tx, 'TP', date)
    const p = await tx.tailorPayment.create({
      data: { docNo, tailorId: tailor.id, docDate: date, amount: input.amount, mode: input.mode, reference: input.reference, notes: input.notes, createdBy: user },
    })
    await audit(tx, { actor: user, action: 'tailor_payment.post', entity: 'tailor_payment', entityId: p.id, summary: `${docNo} ₹${input.amount} ${input.mode} to ${tailor.code} ${tailor.name}` })
    return p.id
  })
  return getPayment(id)
}

export async function cancelPayment(id: number, reason: string, user: string) {
  await assertNotOnPayslip({ tailorPaymentId: id })
  await prisma.$transaction(async (tx) => {
    const p = await tx.tailorPayment.findUnique({ where: { id } })
    if (!p) throw ApiError.notFound('Payment not found')
    const done = await tx.tailorPayment.updateMany({ where: { id, status: 'POSTED' }, data: { status: 'CANCELLED', cancelledBy: user, cancelledAt: new Date(), cancelReason: reason } })
    if (done.count === 0) throw ApiError.conflict(`${p.docNo} is already cancelled`)
    await audit(tx, { actor: user, action: 'tailor_payment.cancel', entity: 'tailor_payment', entityId: id, summary: `${p.docNo} cancelled — ${reason}` })
  })
  return getPayment(id)
}

export async function getPayment(id: number) {
  const p = await prisma.tailorPayment.findUnique({ where: { id }, include: { tailor: { select: { id: true, code: true, name: true } } } })
  if (!p) throw ApiError.notFound('Payment not found')
  return p
}

export function paymentWhere(q: Omit<DocListQuery, 'page' | 'pageSize'> & { tailorId?: number }) {
  const where: Prisma.TailorPaymentWhereInput = {}
  if (q.tailorId) where.tailorId = q.tailorId
  if (q.status === 'POSTED' || q.status === 'CANCELLED') where.status = q.status
  const range = dateRange(q.from, q.to)
  if (range) where.docDate = range
  if (q.search) where.OR = [{ docNo: { contains: q.search, mode: 'insensitive' } }, { reference: { contains: q.search, mode: 'insensitive' } }, { tailor: { name: { contains: q.search, mode: 'insensitive' } } }]
  return where
}

export async function listPayments(q: DocListQuery & { tailorId?: number }) {
  const where = paymentWhere(q)
  const [items, total, sum] = await Promise.all([
    prisma.tailorPayment.findMany({ where, orderBy: byDate(q.order), skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { tailor: { select: { id: true, name: true } } } }),
    prisma.tailorPayment.count({ where }),
    prisma.tailorPayment.aggregate({ where: { AND: [where, { status: 'POSTED' }] }, _sum: { amount: true } }),
  ])
  return { items, total, totalPaid: Number(sum._sum.amount ?? 0), page: q.page, pageSize: q.pageSize }
}
