import { prisma } from '../config/prisma'
import { totals as customerTotals } from '../models/customer.model'
import { baseWhere, statusWhere } from '../models/stock.model'
import { todayIST } from '../utils/financialYear'

// One search box (top bar) for the counter: type a phone, name, job / bill number, product name or code —
// matching customers, stitching jobs, bills and products come back together (a few of each).

const r2 = (n: number) => Math.round(n * 100) / 100
const OPEN = ['PENDING', 'CUTTING', 'STITCHING', 'TRIAL', 'READY'] as const

export async function searchAll(raw: string) {
  const q = raw.trim()
  if (q.length < 2) return { customers: [], jobs: [], bills: [], products: [] }
  const digits = q.replace(/\D/g, '')
  const phone = digits.length >= 4 && digits.length === q.replace(/[\s+-]/g, '').length ? digits.slice(-10) : null
  const text = { contains: q, mode: 'insensitive' as const }

  const [customers, jobs, bills, products] = await Promise.all([
    prisma.customer.findMany({
      where: { isActive: true, OR: phone ? [{ phone: { contains: phone } }] : [{ name: text }, { code: q.toUpperCase() }] },
      orderBy: { name: 'asc' }, take: 5, select: { id: true, code: true, name: true, phone: true, openingBalance: true },
    }),
    prisma.stitchingJob.findMany({
      where: { status: { not: 'CANCELLED' }, OR: phone ? [{ customerPhone: { contains: phone } }, { bookNo: q }] : [{ docNo: text }, { bookNo: { equals: q, mode: 'insensitive' } }, { customerName: text }] },
      orderBy: [{ docDate: 'desc' }, { id: 'desc' }], take: 12,
      select: { id: true, docNo: true, bookNo: true, customerName: true, status: true, expectedDate: true, grandTotal: true, paidAmount: true, returnedAmount: true, items: { select: { description: true, qty: true } } },
    }),
    // Bills only by number (names would bring back every bill of a regular customer — their page lists those).
    prisma.salesInvoice.findMany({
      where: phone ? { bookNo: q } : { OR: [{ docNo: text }, { bookNo: { equals: q, mode: 'insensitive' } }] }, orderBy: { id: 'desc' }, take: 4,
      select: { id: true, docNo: true, bookNo: true, customerName: true, docDate: true, grandTotal: true, status: true },
    }),
    phone ? Promise.resolve([]) : prisma.product.findMany({
      where: { isActive: true, OR: [{ name: text }, { code: q.toUpperCase() }, { variants: { some: { OR: [{ sku: q.toUpperCase() }, { barcode: q }] } } }] },
      orderBy: { name: 'asc' }, take: 5,
      select: { id: true, code: true, name: true, unit: { select: { code: true } }, variants: { select: { stockQty: true, sellingPrice: true } } },
    }),
  ])

  const bal = await customerTotals(customers.map((c) => c.id))
  // Open jobs first (soonest ready-by), then handed-over ones.
  const sorted = [...jobs].sort((a, b) => Number(!OPEN.includes(a.status as never)) - Number(!OPEN.includes(b.status as never)) || a.expectedDate.getTime() - b.expectedDate.getTime()).slice(0, 6)
  return {
    customers: customers.map((c) => {
      const t = bal.get(c.id)!
      return { id: c.id, code: c.code, name: c.name, phone: c.phone, balance: r2(Number(c.openingBalance) + t.billed - t.received - t.returned + t.refunded) }
    }),
    jobs: sorted.map((j) => ({
      id: j.id, docNo: j.docNo, bookNo: j.bookNo, customerName: j.customerName, status: j.status, expectedDate: j.expectedDate,
      due: Math.max(0, r2(Number(j.grandTotal) - Number(j.paidAmount) - Number(j.returnedAmount))),
      garments: j.items.map((i) => `${i.qty} × ${i.description}`).join(', '),
    })),
    bills,
    products: products.map((p) => ({
      id: p.id, code: p.code, name: p.name, unit: p.unit.code,
      stock: r2(p.variants.reduce((s, v) => s + Number(v.stockQty), 0)),
      price: p.variants.length ? Math.min(...p.variants.map((v) => Number(v.sellingPrice))) : 0,
    })),
  }
}

// Top-bar bell "To do today": what needs a staff member's attention now (each opens the right list).
export async function todo() {
  const today = new Date(`${todayIST()}T00:00:00Z`)
  const open = { in: [...OPEN] }
  const [late, dueToday, ready, waiting, low] = await Promise.all([
    prisma.stitchingJob.count({ where: { status: { in: ['PENDING', 'CUTTING', 'STITCHING', 'TRIAL'] }, expectedDate: { lt: today } } }),
    prisma.stitchingJob.count({ where: { status: { in: ['PENDING', 'CUTTING', 'STITCHING', 'TRIAL'] }, expectedDate: today } }),
    prisma.stitchingJob.count({ where: { status: 'READY' } }),
    prisma.stitchingJob.count({ where: { status: open, items: { some: { tailorId: null } } } }),
    prisma.productVariant.count({ where: { AND: [baseWhere({}), statusWhere('low')] } }),
  ])
  return { late, dueToday, ready, waiting, low, total: late + dueToday + ready + waiting + low }
}
