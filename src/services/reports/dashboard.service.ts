import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { todayIST } from '../../utils/financialYear'
import { dayBook } from '../finance/daybook.service'
import { profitAndLoss } from '../finance/profit.service'
import { salesByDay, topItems } from './sales.report'

// Home screen: today's numbers, jobs to watch, low stock, money owed — all live from the books.

type Dec = Prisma.Decimal | number | bigint | null
const n = (v: Dec) => Math.round(Number(v ?? 0) * 100) / 100
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const day = (iso: string) => new Date(`${iso}T00:00:00Z`)
const OPEN = ['PENDING', 'CUTTING', 'STITCHING', 'TRIAL'] as const

// Latest jobs (last 60 days) whose job cost is not entered yet: a garment without a tailor, or no pay / work at all.
async function jobsWithoutCost(today: string) {
  const where = {
    status: { not: 'CANCELLED' as const },
    docDate: { gte: new Date(`${shift(today, -60)}T00:00:00Z`) },
    OR: [{ items: { some: { tailorId: null } } }, { AND: [{ items: { none: { labourRate: { gt: 0 } } } }, { costEntries: { none: {} } }] }],
  }
  const [rows, count] = await Promise.all([
    prisma.stitchingJob.findMany({
      where, orderBy: [{ docDate: 'desc' }, { id: 'desc' }], take: 8,
      select: { id: true, docNo: true, customerName: true, docDate: true, status: true, items: { select: { description: true, qty: true, tailorId: true } } },
    }),
    prisma.stitchingJob.count({ where }),
  ])
  return {
    count,
    items: rows.map((j) => ({
      id: j.id, docNo: j.docNo, customer: j.customerName, docDate: j.docDate, status: j.status,
      garments: j.items.map((i) => `${i.qty > 1 ? `${i.qty}× ` : ''}${i.description}`).join(', '),
      reason: j.items.some((i) => !i.tailorId) ? 'No tailor yet' : 'No pay / work entered',
    })),
  }
}

export async function dashboard() {
  const today = todayIST()
  const monthStart = `${today.slice(0, 8)}01`
  const [sales, book, month, top, jobStats, dueJobs, low, owed, brand] = await Promise.all([
    salesByDay({ from: shift(today, -13), to: today }),
    dayBook({ from: today, to: today }),
    profitAndLoss({ from: monthStart, to: today }),
    topItems({ from: monthStart, to: today, limit: 5 }),
    prisma.$queryRaw<{ open: Dec; overdue: Dec; ready: Dec; due_today: Dec }[]>`
      SELECT COUNT(*) FILTER (WHERE status IN ('PENDING','CUTTING','STITCHING','TRIAL')) AS open,
             COUNT(*) FILTER (WHERE status IN ('PENDING','CUTTING','STITCHING','TRIAL') AND expected_date < ${today}::date) AS overdue,
             COUNT(*) FILTER (WHERE status = 'READY') AS ready,
             COUNT(*) FILTER (WHERE status IN ('PENDING','CUTTING','STITCHING','TRIAL','READY') AND expected_date = ${today}::date) AS due_today
        FROM stitching_jobs`,
    prisma.stitchingJob.findMany({
      where: { status: { in: [...OPEN, 'READY'] }, expectedDate: { lte: day(shift(today, 7)) } },
      orderBy: [{ expectedDate: 'asc' }, { id: 'asc' }],
      take: 8,
      select: {
        id: true, docNo: true, customerName: true, expectedDate: true, status: true, grandTotal: true, paidAmount: true, returnedAmount: true,
        items: { select: { description: true, qty: true, tailor: { select: { name: true } } } },
      },
    }),
    prisma.$queryRaw<{ id: number; product_id: number; name: string; sku: string; stock: Dec; min: Dec; total: Dec }[]>`
      SELECT v.id, p.id AS product_id, p.name, v.sku, v.stock_qty AS stock, v.min_stock AS min, COUNT(*) OVER () AS total
        FROM product_variants v JOIN products p ON p.id = v.product_id
       WHERE v.is_active AND v.min_stock > 0 AND v.stock_qty <= v.min_stock
       ORDER BY v.stock_qty - v.min_stock, p.name LIMIT 6`,
    prisma.$queryRaw<{ customers: Dec; customer_docs: Dec; suppliers: Dec; supplier_bills: Dec; fees: Dec; fee_students: Dec }[]>`
      SELECT (SELECT SUM(b) FROM (SELECT grand_total - paid_amount - returned_amount AS b FROM sales_invoices WHERE status = 'POSTED'
                                  UNION ALL SELECT grand_total - paid_amount - returned_amount FROM stitching_jobs WHERE status <> 'CANCELLED') x WHERE b > 0.004) AS customers,
             (SELECT COUNT(*) FROM (SELECT grand_total - paid_amount - returned_amount AS b FROM sales_invoices WHERE status = 'POSTED'
                                    UNION ALL SELECT grand_total - paid_amount - returned_amount FROM stitching_jobs WHERE status <> 'CANCELLED') x WHERE b > 0.004) AS customer_docs,
             (SELECT SUM(grand_total - paid_amount - returned_amount) FROM purchase_invoices WHERE status = 'POSTED' AND grand_total - paid_amount - returned_amount > 0.004) AS suppliers,
             (SELECT COUNT(*) FROM purchase_invoices WHERE status = 'POSTED' AND grand_total - paid_amount - returned_amount > 0.004) AS supplier_bills,
             (SELECT SUM(due) FROM (SELECT e.fee - COALESCE((SELECT SUM(amount) FROM fee_receipts f WHERE f.enrolment_id = e.id AND f.status = 'POSTED'), 0) AS due FROM enrolments e WHERE e.status <> 'DROPPED') x WHERE due > 0.004) AS fees,
             (SELECT COUNT(*) FROM (SELECT e.fee - COALESCE((SELECT SUM(amount) FROM fee_receipts f WHERE f.enrolment_id = e.id AND f.status = 'POSTED'), 0) AS due FROM enrolments e WHERE e.status <> 'DROPPED') x WHERE due > 0.004) AS fee_students`,
    // Brands we stitch for: what they owe, open / late orders, pieces ready to deliver.
    prisma.$queryRaw<{ pending: Dec; owing: Dec; open: Dec; late: Dec; ready: Dec }[]>`
      WITH bal AS (SELECT b.opening_balance + COALESCE((SELECT SUM(grand_total) FROM brand_bills x WHERE x.brand_id = b.id AND x.status = 'POSTED'), 0)
                          - COALESCE((SELECT SUM(amount) FROM brand_payments p WHERE p.brand_id = b.id AND p.status = 'POSTED'), 0) AS v FROM partner_brands b)
      SELECT (SELECT SUM(v) FROM bal WHERE v > 0.004) AS pending, (SELECT COUNT(*) FROM bal WHERE v > 0.004) AS owing,
             (SELECT COUNT(*) FROM brand_orders WHERE status = 'OPEN') AS open,
             (SELECT COUNT(*) FROM brand_orders WHERE status = 'OPEN' AND expected_date < ${today}::date) AS late,
             (SELECT COALESCE(SUM(i.qty), 0) FROM brand_order_items i JOIN brand_orders o ON o.id = i.order_id WHERE o.status = 'OPEN' AND i.stage = 'READY') AS ready`,
  ])

  const t = sales.days.at(-1)!, y = sales.days.at(-2)!
  const js = jobStats[0], o = owed[0]
  return {
    today,
    sales: {
      today: t.net, yesterday: y.net, billCount: t.billCount, jobCount: t.jobCount,
      last14: sales.days.map((d) => ({ date: d.date, net: d.net })),
    },
    money: { receivedToday: n(book.rows.reduce((s, r) => s + (r.kind === 'RECEIPT' ? r.in : 0), 0)), cash: book.totals.cash.closing, bank: book.totals.bank.closing, spentToday: n(book.totals.cash.out + book.totals.bank.out) },
    month: { income: month.income.total, netProfit: month.netProfit, marginPct: month.marginPct },
    jobs: {
      open: Number(js.open), overdue: Number(js.overdue), ready: Number(js.ready), dueToday: Number(js.due_today),
      due: dueJobs.map((j) => ({
        id: j.id, docNo: j.docNo, customer: j.customerName, expectedDate: j.expectedDate, status: j.status,
        garments: j.items.map((i) => `${i.qty > 1 ? `${i.qty}× ` : ''}${i.description}`).join(', '),
        tailors: [...new Set(j.items.map((i) => i.tailor?.name).filter(Boolean))].join(', '),
        balance: n(Number(j.grandTotal) - Number(j.paidAmount) - Number(j.returnedAmount)),
        overdue: j.status !== 'READY' && j.expectedDate.toISOString().slice(0, 10) < today,
      })),
    },
    lowStock: { count: Number(low[0]?.total ?? 0), items: low.map((l) => ({ variantId: l.id, productId: l.product_id, name: l.name, sku: l.sku, stock: Number(l.stock), min: Number(l.min) })) },
    owed: { byCustomers: n(o.customers), customerDocs: Number(o.customer_docs), toSuppliers: n(o.suppliers), supplierBills: Number(o.supplier_bills), fees: n(o.fees), feeStudents: Number(o.fee_students) },
    brands: { pending: n(brand[0]?.pending), owing: Number(brand[0]?.owing ?? 0), openOrders: Number(brand[0]?.open ?? 0), lateOrders: Number(brand[0]?.late ?? 0), readyPieces: Number(brand[0]?.ready ?? 0) },
    topItems: top.items,
    noCost: await jobsWithoutCost(today),
  }
}
