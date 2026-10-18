import { prisma } from '../config/prisma'
import { nextValue } from '../models/counter.model'
import * as supplierModel from '../models/supplier.model'
import { ApiError } from '../utils/ApiError'
import { gstStates } from '../utils/gst'
import type { SupplierInput, SupplierListQuery } from '../validators/supplier.validator'
import { audit } from './audit.service'

const r2 = (n: number) => Math.round(n * 100) / 100

async function assertUniqueGstin(gstin: string | null, exceptId?: number) {
  if (!gstin) return
  const other = await prisma.supplier.findFirst({ where: { gstin, ...(exceptId ? { NOT: { id: exceptId } } : {}) } })
  if (other) throw ApiError.conflict(`GSTIN ${gstin} is already used by supplier "${other.name}"`)
}

// Suppliers with their current balance (+ = we owe them). Supplier lists are small → filtered in memory.
export async function list(q: SupplierListQuery) {
  const all = await supplierModel.findMany(supplierModel.listWhere(q))
  const totals = await supplierModel.totals(all.map((s) => s.id))
  let rows = all.map((s) => {
    const t = totals.get(s.id)!
    const balance = r2(Number(s.openingBalance) + t.billed - t.paid - t.returned)
    return { ...s, stateName: gstStates[s.stateCode] ?? s.stateCode, billed: t.billed, paid: t.paid, balance }
  })
  if (q.withDues) rows = rows.filter((r) => r.balance > 0)
  const totalDue = r2(rows.reduce((s, r) => s + Math.max(0, r.balance), 0))
  const start = (q.page - 1) * q.pageSize
  return { items: rows.slice(start, start + q.pageSize), total: rows.length, totalDue, page: q.page, pageSize: q.pageSize }
}

export async function getById(id: number) {
  const s = await supplierModel.findById(id)
  if (!s) throw ApiError.notFound('Supplier not found')
  const t = (await supplierModel.totals([id])).get(id)!
  return { ...s, stateName: gstStates[s.stateCode], ...t, balance: r2(Number(s.openingBalance) + t.billed - t.paid - t.returned) }
}

export async function create(input: SupplierInput, user: string) {
  await assertUniqueGstin(input.gstin)
  return prisma.$transaction(async (tx) => {
    const code = `S${String(await nextValue(tx, 'supplier')).padStart(4, '0')}`
    const s = await tx.supplier.create({ data: { ...input, code } })
    await audit(tx, { actor: user, action: 'supplier.create', entity: 'supplier', entityId: s.id, summary: `${code} ${s.name} added` })
    return s
  })
}

export async function update(id: number, input: SupplierInput, user: string) {
  const before = await supplierModel.findById(id)
  if (!before) throw ApiError.notFound('Supplier not found')
  await assertUniqueGstin(input.gstin, id)
  // Opening balance is part of the books once documents exist — changes are logged with old → new.
  return prisma.$transaction(async (tx) => {
    const s = await tx.supplier.update({ where: { id }, data: input })
    const balanceChanged = Number(before.openingBalance) !== input.openingBalance
    await audit(tx, {
      actor: user,
      action: 'supplier.update',
      entity: 'supplier',
      entityId: id,
      summary: `${s.code} updated${balanceChanged ? ` — opening balance ₹${before.openingBalance} → ₹${input.openingBalance}` : ''}`,
    })
    return s
  })
}

export async function remove(id: number, user: string) {
  const s = await supplierModel.findById(id)
  if (!s) throw ApiError.notFound('Supplier not found')
  if ((await supplierModel.documentCount(id)) > 0) {
    throw ApiError.conflict(`"${s.name}" has bills or payments, so it can't be deleted — make it Inactive instead`)
  }
  await prisma.$transaction(async (tx) => {
    await tx.supplier.delete({ where: { id } })
    await audit(tx, { actor: user, action: 'supplier.delete', entity: 'supplier', entityId: id, summary: `${s.code} ${s.name} deleted` })
  })
}

// Running statement: opening → bills (+) → payments / returns (−), by date.
export async function statement(id: number) {
  const supplier = await getById(id)
  const { bills, payments, returns } = await supplierModel.statementRows(id)
  type Row = { date: Date; createdAt: Date; type: 'BILL' | 'PAYMENT' | 'RETURN'; id: number; docNo: string; detail: string; debit: number; credit: number }
  const rows: Row[] = [
    ...bills.map((b) => ({ date: b.docDate, createdAt: b.createdAt, type: 'BILL' as const, id: b.id, docNo: b.docNo, detail: `Supplier bill ${b.supplierInvoiceNo}`, debit: 0, credit: Number(b.grandTotal) })),
    ...payments.map((p) => ({ date: p.docDate, createdAt: p.createdAt, type: 'PAYMENT' as const, id: p.id, docNo: p.docNo, detail: `Paid by ${p.mode}${p.reference ? ` · ${p.reference}` : ''}`, debit: Number(p.amount), credit: 0 })),
    ...returns.map((r) => ({ date: r.docDate, createdAt: r.createdAt, type: 'RETURN' as const, id: r.id, docNo: r.docNo, detail: 'Goods returned', debit: Number(r.grandTotal), credit: 0 })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime())

  let balance = Number(supplier.openingBalance)
  const withBalance = rows.map((r) => {
    balance = r2(balance + r.credit - r.debit)
    return { ...r, balance }
  })
  return { supplier, opening: Number(supplier.openingBalance), rows: withBalance, closing: r2(balance) }
}
