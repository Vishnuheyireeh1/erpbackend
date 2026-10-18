import { byDate } from '../../utils/order'
import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import { dateRange, nextDocNo, toDocDate } from '../../utils/financialYear'
import type { FinanceListQuery, MoneyMoveInput } from '../../validators/finance.validator'
import { audit } from '../audit.service'

// Money moved without a customer or supplier (MOV/…): cash ↔ bank, owner in / out, other income.

export const moveLabels = {
  DEPOSIT: 'Cash deposited to bank',
  WITHDRAW: 'Cash withdrawn from bank',
  OWNER_IN: 'Owner put money in',
  OWNER_OUT: 'Owner took money',
  OTHER_INCOME: 'Other income',
} as const

export async function createMovement(input: MoneyMoveInput, user: string) {
  const { date, isFuture } = toDocDate(input.docDate)
  if (isFuture) throw ApiError.badRequest("Date can't be in the future")
  const id = await prisma.$transaction(async (tx) => {
    const docNo = await nextDocNo(tx, 'MOV', date)
    const m = await tx.moneyMovement.create({ data: { ...input, docNo, docDate: date, createdBy: user } })
    await audit(tx, { actor: user, action: 'money_move.post', entity: 'money_movement', entityId: m.id, summary: `${docNo} ${moveLabels[input.kind]} ₹${input.amount} (${input.mode})` })
    return m.id
  })
  return getMovement(id)
}

export async function cancelMovement(id: number, reason: string, user: string) {
  await prisma.$transaction(async (tx) => {
    const m = await tx.moneyMovement.findUnique({ where: { id } })
    if (!m) throw ApiError.notFound('Entry not found')
    const done = await tx.moneyMovement.updateMany({ where: { id, status: 'POSTED' }, data: { status: 'CANCELLED', cancelledBy: user, cancelledAt: new Date(), cancelReason: reason } })
    if (done.count === 0) throw ApiError.conflict(`${m.docNo} is already cancelled`)
    await audit(tx, { actor: user, action: 'money_move.cancel', entity: 'money_movement', entityId: id, summary: `${m.docNo} cancelled — ${reason}` })
  })
  return getMovement(id)
}

export async function getMovement(id: number) {
  const m = await prisma.moneyMovement.findUnique({ where: { id } })
  if (!m) throw ApiError.notFound('Entry not found')
  return m
}

export function movementWhere(q: Omit<FinanceListQuery, 'page' | 'pageSize'>) {
  const where: Prisma.MoneyMovementWhereInput = {}
  if (q.status !== 'all') where.status = q.status
  if (q.kind) where.kind = q.kind
  const range = dateRange(q.from, q.to)
  if (range) where.docDate = range
  if (q.search) where.OR = [{ docNo: { contains: q.search, mode: 'insensitive' } }, { notes: { contains: q.search, mode: 'insensitive' } }, { reference: { contains: q.search, mode: 'insensitive' } }]
  return where
}

export async function listMovements(q: FinanceListQuery) {
  const where = movementWhere(q)
  const [items, total] = await Promise.all([
    prisma.moneyMovement.findMany({ where, orderBy: byDate(q.order), skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.moneyMovement.count({ where }),
  ])
  return { items, total, page: q.page, pageSize: q.pageSize }
}
