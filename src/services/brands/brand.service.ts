import { prisma } from '../../config/prisma'
import { nextValue } from '../../models/counter.model'
import * as brandModel from '../../models/brand.model'
import { ApiError } from '../../utils/ApiError'
import { gstStates } from '../../utils/gst'
import type { BrandInput, BrandListQuery } from '../../validators/brand.validator'
import { audit } from '../audit.service'

const r2 = (n: number) => Math.round(n * 100) / 100

async function assertUniqueGstin(gstin: string | null, exceptId?: number) {
  if (!gstin) return
  const other = await prisma.partnerBrand.findFirst({ where: { gstin, ...(exceptId ? { NOT: { id: exceptId } } : {}) } })
  if (other) throw ApiError.conflict(`GSTIN ${gstin} is already used by brand "${other.name}"`)
}

// Brands with what they owe the shop (+ = they owe us). Brand lists are small → filtered in memory.
export async function list(q: BrandListQuery) {
  const all = await brandModel.findMany(brandModel.listWhere(q))
  const totals = await brandModel.totals(all.map((b) => b.id))
  let rows = all.map((b) => {
    const t = totals.get(b.id)!
    return { ...b, stateName: gstStates[b.stateCode] ?? b.stateCode, ...t, balance: r2(Number(b.openingBalance) + t.billed - t.paid) }
  })
  if (q.withDues) rows = rows.filter((r) => r.balance > 0)
  const totalDue = r2(rows.reduce((s, r) => s + Math.max(0, r.balance), 0))
  const start = (q.page - 1) * q.pageSize
  return { items: rows.slice(start, start + q.pageSize), total: rows.length, totalDue, page: q.page, pageSize: q.pageSize }
}

export async function getById(id: number) {
  const b = await brandModel.findById(id)
  if (!b) throw ApiError.notFound('Brand not found')
  const t = (await brandModel.totals([id])).get(id)!
  return { ...b, stateName: gstStates[b.stateCode], ...t, balance: r2(Number(b.openingBalance) + t.billed - t.paid) }
}

export async function create(input: BrandInput, user: string) {
  await assertUniqueGstin(input.gstin)
  return prisma.$transaction(async (tx) => {
    const code = `B${String(await nextValue(tx, 'partnerBrand')).padStart(4, '0')}`
    const b = await tx.partnerBrand.create({ data: { ...input, code } })
    await audit(tx, { actor: user, action: 'brand.create', entity: 'brand', entityId: b.id, summary: `${code} ${b.name} added` })
    return b
  })
}

export async function update(id: number, input: BrandInput, user: string) {
  const before = await brandModel.findById(id)
  if (!before) throw ApiError.notFound('Brand not found')
  await assertUniqueGstin(input.gstin, id)
  // Opening balance is part of the books — changes are logged with old → new.
  return prisma.$transaction(async (tx) => {
    const b = await tx.partnerBrand.update({ where: { id }, data: input })
    const balanceChanged = Number(before.openingBalance) !== input.openingBalance
    await audit(tx, {
      actor: user,
      action: 'brand.update',
      entity: 'brand',
      entityId: id,
      summary: `${b.code} updated${balanceChanged ? ` — opening balance ₹${before.openingBalance} → ₹${input.openingBalance}` : ''}`,
    })
    return b
  })
}

// Hard delete — only while nothing uses the brand (otherwise make it Inactive).
export async function remove(id: number, user: string) {
  const b = await brandModel.findById(id)
  if (!b) throw ApiError.notFound('Brand not found')
  if ((await brandModel.documentCount(id)) > 0) {
    throw ApiError.conflict(`"${b.name}" has orders, bills or payments, so it can't be deleted — make it Inactive instead`)
  }
  await prisma.$transaction(async (tx) => {
    await tx.partnerBrand.delete({ where: { id } })
    await audit(tx, { actor: user, action: 'brand.delete', entity: 'brand', entityId: id, summary: `${b.code} ${b.name} deleted` })
  })
}
