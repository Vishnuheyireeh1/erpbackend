import { prisma } from '../config/prisma'
import { nextValue } from '../models/counter.model'
import * as customerModel from '../models/customer.model'
import { ApiError } from '../utils/ApiError'
import { gstStates } from '../utils/gst'
import type { CustomerInput, CustomerListQuery } from '../validators/sales.validator'
import { audit } from './audit.service'

const r2 = (n: number) => Math.round(n * 100) / 100
type T = { billed: number; received: number; returned: number; refunded: number }
const balanceOf = (opening: unknown, t: T) => r2(Number(opening) + t.billed - t.received - t.returned + t.refunded)

// Stitching jobs per customer: all (not cancelled) and still open (not handed over).
async function jobCounts(ids: number[]) {
  const rows = await prisma.stitchingJob.groupBy({ by: ['customerId', 'status'], where: { customerId: { in: ids }, status: { not: 'CANCELLED' } }, _count: { _all: true } })
  const map = new Map<number, { jobs: number; openJobs: number }>()
  for (const r of rows) {
    const m = map.get(r.customerId) ?? { jobs: 0, openJobs: 0 }
    m.jobs += r._count._all
    if (r.status !== 'DELIVERED') m.openJobs += r._count._all
    map.set(r.customerId, m)
  }
  return (id: number) => map.get(id) ?? { jobs: 0, openJobs: 0 }
}

// Customers with their current balance (+ = they owe the shop, − = advance / credit) and their stitching jobs.
export async function list(q: CustomerListQuery) {
  const where = customerModel.listWhere(q)
  if (!q.withDues) {
    const [items, total] = await Promise.all([
      prisma.customer.findMany({ where, orderBy: q.sort === 'recent' ? [{ updatedAt: 'desc' }, { id: 'desc' }] : { name: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.customer.count({ where }),
    ])
    const [totals, jobs] = await Promise.all([customerModel.totals(items.map((c) => c.id)), jobCounts(items.map((c) => c.id))])
    return { items: items.map((c) => ({ ...c, stateName: gstStates[c.stateCode], ...totals.get(c.id)!, ...jobs(c.id), balance: balanceOf(c.openingBalance, totals.get(c.id)!) })), total, page: q.page, pageSize: q.pageSize }
  }
  // "Has dues" needs every balance → computed for all matching customers.
  const all = await prisma.customer.findMany({ where, orderBy: { name: 'asc' } })
  const totals = await customerModel.totals(all.map((c) => c.id))
  const rows = all.map((c) => ({ ...c, stateName: gstStates[c.stateCode], ...totals.get(c.id)!, balance: balanceOf(c.openingBalance, totals.get(c.id)!) })).filter((c) => c.balance > 0)
  const start = (q.page - 1) * q.pageSize
  const page = rows.slice(start, start + q.pageSize)
  const jobs = await jobCounts(page.map((c) => c.id))
  return { items: page.map((c) => ({ ...c, ...jobs(c.id) })), total: rows.length, totalDue: r2(rows.reduce((s, c) => s + c.balance, 0)), page: q.page, pageSize: q.pageSize }
}

export async function getById(id: number) {
  const c = await prisma.customer.findUnique({ where: { id } })
  if (!c) throw ApiError.notFound('Customer not found')
  const t = (await customerModel.totals([id])).get(id)!
  return { ...c, stateName: gstStates[c.stateCode], ...t, balance: balanceOf(c.openingBalance, t) }
}

export async function create(input: CustomerInput, user: string) {
  return prisma.$transaction(async (tx) => {
    const code = `C${String(await nextValue(tx, 'customer')).padStart(4, '0')}`
    const c = await tx.customer.create({ data: { ...input, code } })
    await audit(tx, { actor: user, action: 'customer.create', entity: 'customer', entityId: c.id, summary: `${code} ${c.name} added` })
    return c
  })
}

export async function update(id: number, input: CustomerInput, user: string) {
  const before = await prisma.customer.findUnique({ where: { id } })
  if (!before) throw ApiError.notFound('Customer not found')
  return prisma.$transaction(async (tx) => {
    const c = await tx.customer.update({ where: { id }, data: input })
    const changed = Number(before.openingBalance) !== input.openingBalance
    await audit(tx, { actor: user, action: 'customer.update', entity: 'customer', entityId: id, summary: `${c.code} updated${changed ? ` — opening balance ₹${before.openingBalance} → ₹${input.openingBalance}` : ''}` })
    return c
  })
}

export async function remove(id: number, user: string) {
  const c = await prisma.customer.findUnique({ where: { id } })
  if (!c) throw ApiError.notFound('Customer not found')
  if ((await customerModel.documentCount(id)) > 0) throw ApiError.conflict(`"${c.name}" has bills, receipts or measurements, so it can't be deleted — make it Inactive instead`)
  await prisma.$transaction(async (tx) => {
    await tx.customer.delete({ where: { id } })
    await audit(tx, { actor: user, action: 'customer.delete', entity: 'customer', entityId: id, summary: `${c.code} ${c.name} deleted` })
  })
}

// Running statement: opening → bills (+) → money received / returns (−) → refunds paid (+).
export async function statement(id: number) {
  const customer = await getById(id)
  const { sales, jobs, receipts, returns } = await customerModel.statementRows(id)
  type Row = { date: Date; createdAt: Date; type: 'BILL' | 'JOB' | 'RECEIPT' | 'RETURN' | 'REFUND'; id: number; docNo: string; detail: string; debit: number; credit: number }
  const rows: Row[] = [
    ...sales.map((s) => ({ date: s.docDate, createdAt: s.createdAt, type: 'BILL' as const, id: s.id, docNo: s.docNo, detail: 'Sales bill', debit: Number(s.grandTotal), credit: 0 })),
    ...jobs.map((j) => ({ date: j.docDate, createdAt: j.createdAt, type: 'JOB' as const, id: j.id, docNo: j.docNo, detail: `Stitching job (${j.status.toLowerCase()})`, debit: Number(j.grandTotal), credit: 0 })),
    ...receipts.map((r) => ({ date: r.docDate, createdAt: r.createdAt, type: 'RECEIPT' as const, id: r.id, docNo: r.docNo, detail: `Received (${[...new Set(r.tenders.map((t) => t.mode))].join(' + ')})`, debit: 0, credit: Number(r.amount) })),
    ...returns.map((r) => ({ date: r.docDate, createdAt: r.createdAt, type: 'RETURN' as const, id: r.id, docNo: r.docNo, detail: 'Goods returned', debit: 0, credit: Number(r.grandTotal) })),
    ...returns.filter((r) => Number(r.refundAmount) > 0).map((r) => ({ date: r.docDate, createdAt: r.createdAt, type: 'REFUND' as const, id: r.id, docNo: r.docNo, detail: `Refund paid (${r.refundMode})`, debit: Number(r.refundAmount), credit: 0 })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime())
  let balance = Number(customer.openingBalance)
  const withBalance = rows.map((r) => ({ ...r, balance: (balance = r2(balance + r.debit - r.credit)) }))
  return { customer, opening: Number(customer.openingBalance), rows: withBalance, closing: r2(balance) }
}
