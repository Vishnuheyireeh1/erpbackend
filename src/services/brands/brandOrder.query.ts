import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import { dateRange, todayIST } from '../../utils/financialYear'
import { byDate } from '../../utils/order'
import type { BrandOrderListQuery } from '../../validators/brandOrder.validator'
import { clothBalance } from './brandCloth.service'
import { profitOf } from './brandOrder.costs'

const r2 = (n: number) => Math.round(n * 100) / 100

export function orderWhere(q: Omit<BrandOrderListQuery, 'page' | 'pageSize' | 'order'>): Prisma.BrandOrderWhereInput {
  const where: Prisma.BrandOrderWhereInput = {}
  const today = new Date(`${todayIST()}T00:00:00Z`)
  if (q.view === 'open') where.status = 'OPEN'
  if (q.view === 'ready') Object.assign(where, { status: 'OPEN', items: { some: { stage: 'READY' } } })
  if (q.view === 'late') Object.assign(where, { status: 'OPEN', expectedDate: { lt: today } })
  if (q.view === 'completed') where.status = 'COMPLETED'
  if (q.view === 'cancelled') where.status = 'CANCELLED'
  if (q.brandId) where.brandId = q.brandId
  const range = dateRange(q.from, q.to)
  if (range) where.docDate = range
  if (q.search) {
    const s = q.search
    where.OR = [
      { docNo: { contains: s, mode: 'insensitive' } },
      { brandName: { contains: s, mode: 'insensitive' } },
      { theirOrderNo: { contains: s, mode: 'insensitive' } },
      { items: { some: { endCustomer: { contains: s, mode: 'insensitive' } } } },
    ]
  }
  return where
}

type Charged = { charges: { amount: Prisma.Decimal }[] }
const chargesOf = (i: Charged) => i.charges.reduce((s, c) => s + Number(c.amount), 0)
type Summed = { status: string; items: ({ qty: number; chargeRate: Prisma.Decimal; stage: string } & Charged)[]; materials: { amount: Prisma.Decimal }[] }
// Pieces by stage and the order's value (pieces + charges + items charged), before any bill.
export function orderSums(o: Summed) {
  const count = (stage?: string) => o.items.filter((i) => !stage || i.stage === stage).reduce((s, i) => s + i.qty, 0)
  const value = r2(o.items.reduce((s, i) => s + i.qty * Number(i.chargeRate) + chargesOf(i), 0) + o.materials.reduce((s, m) => s + Number(m.amount), 0))
  return { pieces: count(), inWork: count('IN_WORK'), ready: count('READY'), delivered: count('DELIVERED'), value }
}

// What this order comes to and what is left: delivered pieces at their bills (GST and round off included), the rest at their price.
type Moneyed = { status: string; items: ({ id: number; qty: number; chargeRate: Prisma.Decimal; stage: string } & Charged)[]; materials: { itemId: number; amount: Prisma.Decimal }[]; bills: { status: string; grandTotal: Prisma.Decimal }[]; payments: { amount: Prisma.Decimal }[] }
function orderMoney(o: Moneyed) {
  const billed = o.bills.filter((b) => b.status === 'POSTED').reduce((s, b) => s + Number(b.grandTotal), 0)
  const notBilled = o.items.filter((i) => i.stage !== 'DELIVERED').reduce((s, i) => s + i.qty * Number(i.chargeRate) + chargesOf(i) + o.materials.filter((m) => m.itemId === i.id).reduce((t, m) => t + Number(m.amount), 0), 0)
  const total = o.status === 'CANCELLED' ? 0 : r2(billed + notBilled)
  const received = r2(o.payments.reduce((s, p) => s + Number(p.amount), 0))
  return { total, received, balance: r2(Math.max(0, total - received)) }
}

export async function listOrders(q: BrandOrderListQuery) {
  const where = orderWhere(q)
  const [rows, total] = await Promise.all([
    prisma.brandOrder.findMany({
      where, orderBy: byDate(q.order), skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      include: { items: { select: { qty: true, chargeRate: true, stage: true, charges: { select: { amount: true } } } }, materials: { select: { amount: true } } },
    }),
    prisma.brandOrder.count({ where }),
  ])
  const items = rows.map(({ items, materials, ...o }) => ({ ...o, ...orderSums({ ...o, items, materials }) }))
  return { items, total, page: q.page, pageSize: q.pageSize }
}

export async function getOrder(id: number) {
  const order = await prisma.brandOrder.findUnique({
    where: { id },
    include: {
      brand: { select: { id: true, code: true, name: true, phone: true, gstin: true, gstRate: true } },
      items: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        include: { charges: { orderBy: { sortOrder: 'asc' } }, garmentType: { select: { id: true, name: true, fields: true } }, tailor: { select: { id: true, name: true, payType: true } }, measuredBy: { select: { id: true, name: true } } },
      },
      materials: { orderBy: { id: 'asc' }, include: { variant: { select: { sku: true, product: { select: { unit: { select: { code: true } } } } } } } },
      bills: { orderBy: { id: 'asc' }, select: { id: true, docNo: true, docDate: true, grandTotal: true, gstRate: true, status: true, _count: { select: { items: true } } } },
      clothEntries: { orderBy: [{ date: 'asc' }, { id: 'asc' }] },
      payments: { where: { status: 'POSTED' }, orderBy: [{ docDate: 'asc' }, { id: 'asc' }], select: { id: true, docNo: true, docDate: true, amount: true, mode: true, reference: true } },
      costs: { orderBy: [{ date: 'asc' }, { id: 'asc' }], include: { category: { select: { id: true, name: true } }, tailor: { select: { id: true, name: true } }, item: { select: { id: true, description: true, endCustomer: true } } } },
    },
  })
  if (!order) throw ApiError.notFound('Brand order not found')
  const profit = (await profitOf([id])).get(id)
  return { ...order, ...orderSums(order), ...orderMoney(order), cloth: clothBalance(order.clothEntries), profit }
}
