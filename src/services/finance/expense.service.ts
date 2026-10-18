import { byDate } from '../../utils/order'
import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import { dateRange, nextDocNo, toDocDate } from '../../utils/financialYear'
import type { ExpenseCategoryInput, ExpenseInput, FinanceListQuery } from '../../validators/finance.validator'
import { audit } from '../audit.service'

// Shop expenses (EXP/…) and their types. Cancel only — an expense is never edited or deleted.

export async function createExpense(input: ExpenseInput, user: string) {
  const { date, isFuture } = toDocDate(input.docDate)
  if (isFuture) throw ApiError.badRequest("Date can't be in the future")
  const cat = await prisma.expenseCategory.findUnique({ where: { id: input.categoryId } })
  if (!cat || !cat.isActive) throw ApiError.badRequest('Choose an active expense type')
  const id = await prisma.$transaction(async (tx) => {
    const docNo = await nextDocNo(tx, 'EXP', date)
    const e = await tx.expense.create({ data: { ...input, docNo, docDate: date, createdBy: user } })
    await audit(tx, { actor: user, action: 'expense.post', entity: 'expense', entityId: e.id, summary: `${docNo} ${cat.name} ₹${input.amount} (${input.mode})${input.paidTo ? ` to ${input.paidTo}` : ''}` })
    return e.id
  })
  return getExpense(id)
}

export async function cancelExpense(id: number, reason: string, user: string) {
  await prisma.$transaction(async (tx) => {
    const e = await tx.expense.findUnique({ where: { id } })
    if (!e) throw ApiError.notFound('Expense not found')
    const done = await tx.expense.updateMany({ where: { id, status: 'POSTED' }, data: { status: 'CANCELLED', cancelledBy: user, cancelledAt: new Date(), cancelReason: reason } })
    if (done.count === 0) throw ApiError.conflict(`${e.docNo} is already cancelled`)
    await audit(tx, { actor: user, action: 'expense.cancel', entity: 'expense', entityId: id, summary: `${e.docNo} cancelled — ${reason}` })
  })
  return getExpense(id)
}

export async function getExpense(id: number) {
  const e = await prisma.expense.findUnique({ where: { id }, include: { category: { select: { id: true, name: true, kind: true } } } })
  if (!e) throw ApiError.notFound('Expense not found')
  return e
}

export function expenseWhere(q: Omit<FinanceListQuery, 'page' | 'pageSize'>) {
  const where: Prisma.ExpenseWhereInput = {}
  if (q.status !== 'all') where.status = q.status
  if (q.categoryId) where.categoryId = q.categoryId
  if (q.expenseKind) where.category = { kind: q.expenseKind }
  const range = dateRange(q.from, q.to)
  if (range) where.docDate = range
  if (q.search) {
    where.OR = [
      { docNo: { contains: q.search, mode: 'insensitive' } },
      { paidTo: { contains: q.search, mode: 'insensitive' } },
      { notes: { contains: q.search, mode: 'insensitive' } },
      { category: { name: { contains: q.search, mode: 'insensitive' } } },
    ]
  }
  return where
}

export async function listExpenses(q: FinanceListQuery) {
  const where = expenseWhere(q)
  const [items, total, sum, byCategory] = await Promise.all([
    prisma.expense.findMany({ where, orderBy: byDate(q.order), skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { category: { select: { id: true, name: true, kind: true } } } }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where: { AND: [where, { status: 'POSTED' }] }, _sum: { amount: true } }),
    prisma.expense.groupBy({ by: ['categoryId'], where: { AND: [where, { status: 'POSTED' }] }, _sum: { amount: true } }),
  ])
  const names = new Map((await prisma.expenseCategory.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]))
  const summary = byCategory.map((b) => ({ name: names.get(b.categoryId) ?? '', amount: Number(b._sum.amount ?? 0) })).sort((a, b) => b.amount - a.amount)
  return { items, total, totalAmount: Number(sum._sum.amount ?? 0), byCategory: summary, page: q.page, pageSize: q.pageSize }
}

// ---- Expense types ----
export async function listCategories() {
  const items = await prisma.expenseCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { _count: { select: { expenses: true } } } })
  return items.map(({ _count, ...c }) => ({ ...c, used: _count.expenses }))
}

export async function saveCategory(id: number | null, input: ExpenseCategoryInput, user: string) {
  return prisma.$transaction(async (tx) => {
    const c = id ? await tx.expenseCategory.update({ where: { id }, data: input }) : await tx.expenseCategory.create({ data: input })
    await audit(tx, { actor: user, action: id ? 'expense_category.update' : 'expense_category.create', entity: 'expense_category', entityId: c.id, summary: `${c.name} ${id ? 'updated' : 'added'}` })
    return c
  })
}

export async function removeCategory(id: number, user: string) {
  const c = await prisma.expenseCategory.findUnique({ where: { id }, include: { _count: { select: { expenses: true } } } })
  if (!c) throw ApiError.notFound('Expense type not found')
  if (c._count.expenses) throw ApiError.conflict(`${c.name} is used on ${c._count.expenses} expense(s) — make it Inactive instead`)
  await prisma.$transaction(async (tx) => {
    await tx.expenseCategory.delete({ where: { id } })
    await audit(tx, { actor: user, action: 'expense_category.delete', entity: 'expense_category', entityId: id, summary: `${c.name} deleted` })
  })
}
