import { prisma } from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { dateRange, todayIST } from '../../utils/financialYear'
import type { BrandReportQuery } from '../../validators/brandBill.validator'
import * as brandModel from '../../models/brand.model'
import { clothBalance } from '../brands/brandCloth.service'
import { monthRange } from './workshop.report'
import { profitOf } from '../brands/brandOrder.costs'

// Brand reports. Money figures follow the books: billed = delivery bills, income = bill before GST,
// our cloth = stock cost of items from our stock on the order, tailor pay = per-piece pay of pieces ready / delivered,
// other costs = embroidery, hand work … added on the order.

const r2 = (n: number) => Math.round(n * 100) / 100

// Per brand for the period: orders received, pieces ordered / delivered, billed, received — and pending today.
export async function brandSummary(q: BrandReportQuery) {
  const { from, to } = monthRange(q)
  const range = dateRange(from, to)!
  const brands = await prisma.partnerBrand.findMany({ where: q.brandId ? { id: q.brandId } : {}, orderBy: { name: 'asc' } })
  const ids = brands.map((b) => b.id)
  const [orders, bills, payments, delivered, totals] = await Promise.all([
    prisma.brandOrder.findMany({ where: { brandId: { in: ids }, status: { not: 'CANCELLED' }, docDate: range }, select: { brandId: true, items: { select: { qty: true } } } }),
    prisma.brandBill.groupBy({ by: ['brandId'], where: { brandId: { in: ids }, status: 'POSTED', docDate: range }, _sum: { grandTotal: true, taxableTotal: true } }),
    prisma.brandPayment.groupBy({ by: ['brandId'], where: { brandId: { in: ids }, status: 'POSTED', docDate: range }, _sum: { amount: true } }),
    prisma.$queryRaw<{ brand_id: number; pieces: Prisma.Decimal }[]>`SELECT b.brand_id, SUM(l.qty) AS pieces FROM brand_bill_lines l JOIN brand_bills b ON b.id = l.bill_id
      WHERE b.status = 'POSTED' AND l.kind = 'PIECE' AND b.doc_date BETWEEN ${from}::date AND ${to}::date GROUP BY b.brand_id`,
    brandModel.totals(ids),
  ])
  const rows = brands.map((b) => {
    const mine = orders.filter((o) => o.brandId === b.id)
    const t = totals.get(b.id)!
    return {
      brandId: b.id, code: b.code, name: b.name, orders: mine.length,
      piecesOrdered: mine.reduce((s, o) => s + o.items.reduce((x, i) => x + i.qty, 0), 0),
      piecesDelivered: Number(delivered.find((d) => d.brand_id === b.id)?.pieces ?? 0),
      billed: r2(Number(bills.find((x) => x.brandId === b.id)?._sum.grandTotal ?? 0)),
      income: r2(Number(bills.find((x) => x.brandId === b.id)?._sum.taxableTotal ?? 0)),
      received: r2(Number(payments.find((x) => x.brandId === b.id)?._sum.amount ?? 0)),
      pending: r2(Number(b.openingBalance) + t.billed - t.paid),
    }
  })
  const sum = (k: 'orders' | 'piecesOrdered' | 'piecesDelivered' | 'billed' | 'income' | 'received' | 'pending') => r2(rows.reduce((s, r) => s + r[k], 0))
  return { from, to, rows, totals: { orders: sum('orders'), piecesOrdered: sum('piecesOrdered'), piecesDelivered: sum('piecesDelivered'), billed: sum('billed'), income: sum('income'), received: sum('received'), pending: sum('pending') } }
}

// Pieces not delivered yet (open orders), soonest due first.
export async function pendingWork(q: BrandReportQuery) {
  const today = todayIST()
  const items = await prisma.brandOrderItem.findMany({
    where: { stage: { not: 'DELIVERED' }, order: { status: 'OPEN', ...(q.brandId ? { brandId: q.brandId } : {}) } },
    orderBy: [{ order: { expectedDate: 'asc' } }, { orderId: 'asc' }, { sortOrder: 'asc' }],
    include: { order: { select: { id: true, docNo: true, brandName: true, theirOrderNo: true, expectedDate: true } }, tailor: { select: { name: true } }, charges: { select: { amount: true } } },
  })
  const rows = items.map((i) => ({
    orderId: i.order.id, docNo: i.order.docNo, brand: i.order.brandName, theirOrderNo: i.order.theirOrderNo, due: i.order.expectedDate,
    late: i.order.expectedDate.toISOString().slice(0, 10) < today, piece: i.description, endCustomer: i.endCustomer, qty: i.qty,
    tailor: i.tailor?.name ?? null, stage: i.stage, value: r2(i.qty * Number(i.chargeRate) + i.charges.reduce((s, c) => s + Number(c.amount), 0)),
  }))
  return { rows, totals: { pieces: rows.reduce((s, r) => s + r.qty, 0), ready: rows.filter((r) => r.stage === 'READY').reduce((s, r) => s + r.qty, 0), late: rows.filter((r) => r.late).reduce((s, r) => s + r.qty, 0), value: r2(rows.reduce((s, r) => s + r.value, 0)) } }
}

// Orders received in the period: billed (before GST) − our cloth − tailor pay = profit (so far, for open orders).
export async function orderProfit(q: BrandReportQuery) {
  const { from, to } = monthRange(q)
  const orders = await prisma.brandOrder.findMany({
    where: { status: { not: 'CANCELLED' }, docDate: dateRange(from, to), ...(q.brandId ? { brandId: q.brandId } : {}) },
    orderBy: [{ docDate: 'desc' }, { id: 'desc' }],
    include: { items: { select: { qty: true, stage: true } } },
  })
  const money = await profitOf(orders.map((o) => o.id))
  const rows = orders.map((o) => {
    const pieces = o.items.reduce((s, i) => s + i.qty, 0)
    const delivered = o.items.filter((i) => i.stage === 'DELIVERED').reduce((s, i) => s + i.qty, 0)
    const m = money.get(o.id) ?? { billed: 0, ourCloth: 0, tailorPay: 0, otherCosts: 0, profit: 0 }
    return { orderId: o.id, docNo: o.docNo, docDate: o.docDate, brand: o.brandName, status: o.status, pieces, delivered, ...m }
  })
  const sum = (k: 'billed' | 'ourCloth' | 'tailorPay' | 'otherCosts' | 'profit') => r2(rows.reduce((s, r) => s + r[k], 0))
  return { from, to, rows, totals: { billed: sum('billed'), ourCloth: sum('ourCloth'), tailorPay: sum('tailorPay'), otherCosts: sum('otherCosts'), profit: sum('profit') } }
}

// Per customer of the brand (the name on each piece) for orders received in the dates: pieces, delivered, pending and the
// bill amount, same as the customer's bill: stitching fee + charges + items charged. Same name in any case = one customer.
export async function customerReport(q: BrandReportQuery) {
  const { from, to } = monthRange(q)
  const items = await prisma.brandOrderItem.findMany({
    where: { order: { status: { not: 'CANCELLED' }, docDate: dateRange(from, to), ...(q.brandId ? { brandId: q.brandId } : {}) } },
    orderBy: [{ order: { docDate: 'desc' } }, { orderId: 'desc' }, { sortOrder: 'asc' }],
    include: { order: { select: { id: true, docNo: true, docDate: true, brandName: true } }, materials: { where: { charged: true }, select: { amount: true } }, charges: { select: { amount: true } } },
  })
  type Row = { customer: string; brands: Set<string>; orders: Set<number>; pieces: number; delivered: number; amount: number; list: { itemId: number; orderId: number; docNo: string; docDate: Date; brand: string; piece: string; qty: number; stage: string; amount: number }[] }
  const groups = new Map<string, Row>()
  for (const i of items) {
    const name = i.endCustomer?.trim() ?? ''
    const key = name.toLowerCase()
    if (!groups.has(key)) groups.set(key, { customer: name || 'No customer name', brands: new Set(), orders: new Set(), pieces: 0, delivered: 0, amount: 0, list: [] })
    const g = groups.get(key)!
    const amount = r2(i.qty * Number(i.chargeRate) + i.charges.reduce((s, c) => s + Number(c.amount), 0) + i.materials.reduce((s, m) => s + Number(m.amount), 0))
    g.brands.add(i.order.brandName)
    g.orders.add(i.order.id)
    g.pieces += i.qty
    if (i.stage === 'DELIVERED') g.delivered += i.qty
    g.amount = r2(g.amount + amount)
    g.list.push({ itemId: i.id, orderId: i.order.id, docNo: i.order.docNo, docDate: i.order.docDate, brand: i.order.brandName, piece: i.description, qty: i.qty, stage: i.stage, amount })
  }
  const search = q.search?.toLowerCase()
  const rows = [...groups.values()]
    .filter((g) => !search || g.customer.toLowerCase().includes(search))
    .map((g) => ({ customer: g.customer, brands: [...g.brands].join(', '), orders: g.orders.size, pieces: g.pieces, delivered: g.delivered, pending: g.pieces - g.delivered, amount: g.amount, list: g.list }))
    .sort((a, b) => a.customer.localeCompare(b.customer))
  const sum = (k: 'pieces' | 'delivered' | 'pending' | 'amount') => r2(rows.reduce((s, r) => s + r[k], 0))
  return { from, to, rows, totals: { customers: rows.length, pieces: sum('pieces'), delivered: sum('delivered'), pending: sum('pending'), amount: sum('amount') } }
}

// The brands' own cloth with us, per order: received − used − given back.
export async function clothReport(q: BrandReportQuery) {
  const entries = await prisma.brandClothEntry.findMany({
    where: { ...(q.brandId ? { brandId: q.brandId } : {}), order: { status: { not: 'CANCELLED' } } },
    orderBy: [{ orderId: 'asc' }, { date: 'asc' }],
    include: { order: { select: { id: true, docNo: true, brandName: true, status: true } } },
  })
  const byOrder = new Map<number, typeof entries>()
  for (const e of entries) byOrder.set(e.orderId, [...(byOrder.get(e.orderId) ?? []), e])
  const rows = [...byOrder.values()].flatMap((list) => clothBalance(list).map((c) => ({ orderId: list[0].order.id, docNo: list[0].order.docNo, brand: list[0].order.brandName, orderStatus: list[0].order.status, ...c })))
  return { rows }
}
