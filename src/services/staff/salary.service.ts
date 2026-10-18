import { byDate } from '../../utils/order'
import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import { dateRange, nextDocNo, toDocDate } from '../../utils/financialYear'
import type { SalaryListQuery, SalaryPaymentInput } from '../../validators/staff.validator'
import { audit } from '../audit.service'
import { assertNotOnPayslip } from './payroll.service'

// Salary paid (SAL/…). Cancel only — never edited or deleted. Counted in the day book on the paid date
// and in profit & loss in the salary month.

const monthDate = (m: string) => new Date(`${m}-01T00:00:00Z`)
const include = { staff: { select: { id: true, code: true, name: true, role: true, dept: true } } } as const

export async function createPayment(input: SalaryPaymentInput, user: string) {
  const { date, isFuture } = toDocDate(input.docDate)
  if (isFuture) throw ApiError.badRequest("Date can't be in the future")
  const staff = await prisma.staff.findUnique({ where: { id: input.staffId } })
  if (!staff) throw ApiError.badRequest('Staff member not found')
  if (!staff.isActive) throw ApiError.badRequest(`${staff.name} is inactive — make them active first`)
  const month = monthDate(input.month)
  const slip = await prisma.payslip.findFirst({ where: { staffId: staff.id, month, status: 'POSTED' }, select: { docNo: true } })
  if (slip) throw ApiError.conflict(`${staff.name}'s ${input.month} salary is already paid by payslip ${slip.docNo} — choose the next month for an advance`)
  const id = await prisma.$transaction(async (tx) => {
    const docNo = await nextDocNo(tx, 'SAL', date)
    const p = await tx.salaryPayment.create({ data: { ...input, month, docNo, docDate: date, createdBy: user } })
    await audit(tx, { actor: user, action: 'salary.pay', entity: 'salary_payment', entityId: p.id, summary: `${docNo} ${staff.name} — ${input.month} salary ₹${input.amount} (${input.mode})` })
    return p.id
  })
  return getPayment(id)
}

export async function cancelPayment(id: number, reason: string, user: string) {
  await assertNotOnPayslip({ salaryPaymentId: id })
  await prisma.$transaction(async (tx) => {
    const p = await tx.salaryPayment.findUnique({ where: { id } })
    if (!p) throw ApiError.notFound('Salary payment not found')
    const done = await tx.salaryPayment.updateMany({ where: { id, status: 'POSTED' }, data: { status: 'CANCELLED', cancelledBy: user, cancelledAt: new Date(), cancelReason: reason } })
    if (done.count === 0) throw ApiError.conflict(`${p.docNo} is already cancelled`)
    await audit(tx, { actor: user, action: 'salary.cancel', entity: 'salary_payment', entityId: id, summary: `${p.docNo} cancelled — ${reason}` })
  })
  return getPayment(id)
}

export async function getPayment(id: number) {
  const p = await prisma.salaryPayment.findUnique({ where: { id }, include })
  if (!p) throw ApiError.notFound('Salary payment not found')
  return p
}

export function paymentWhere(q: Omit<SalaryListQuery, 'page' | 'pageSize'>) {
  const where: Prisma.SalaryPaymentWhereInput = {}
  if (q.status !== 'all') where.status = q.status
  if (q.staffId) where.staffId = q.staffId
  if (q.month) where.month = monthDate(q.month)
  const range = dateRange(q.from, q.to)
  if (range) where.docDate = range
  if (q.search) {
    where.OR = [
      { docNo: { contains: q.search, mode: 'insensitive' } },
      { notes: { contains: q.search, mode: 'insensitive' } },
      { staff: { name: { contains: q.search, mode: 'insensitive' } } },
    ]
  }
  return where
}

export async function listPayments(q: SalaryListQuery) {
  const where = paymentWhere(q)
  const [items, total, sum] = await Promise.all([
    prisma.salaryPayment.findMany({ where, include, orderBy: byDate(q.order), skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.salaryPayment.count({ where }),
    prisma.salaryPayment.aggregate({ where: { ...where, status: 'POSTED' }, _sum: { amount: true } }),
  ])
  return { items, total, page: q.page, pageSize: q.pageSize, totalPaid: Number(sum._sum.amount ?? 0) }
}
