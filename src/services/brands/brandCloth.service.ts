import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import { toDocDate } from '../../utils/financialYear'
import type { BrandClothInput } from '../../validators/brandBill.validator'
import { audit } from '../audit.service'

// The brand's own cloth for an order (not our stock): received from them, used for pieces, given back.
// Left with us = received − used − given back, per cloth + unit.

const r3 = (n: number) => Math.round(n * 1000) / 1000
const KIND: Record<string, string> = { RECEIVED: 'received', USED: 'used', RETURNED: 'given back' }

export function listEntries(orderId: number) {
  return prisma.brandClothEntry.findMany({ where: { orderId }, orderBy: [{ date: 'asc' }, { id: 'asc' }] })
}

export function clothBalance(entries: { description: string; unit: string; kind: string; qty: unknown }[]) {
  const map = new Map<string, { description: string; unit: string; received: number; used: number; returned: number; left: number }>()
  for (const e of entries) {
    const key = `${e.description.trim().toLowerCase()}|${e.unit.toLowerCase()}`
    const row = map.get(key) ?? { description: e.description.trim(), unit: e.unit, received: 0, used: 0, returned: 0, left: 0 }
    const q = Number(e.qty)
    if (e.kind === 'RECEIVED') row.received = r3(row.received + q)
    if (e.kind === 'USED') row.used = r3(row.used + q)
    if (e.kind === 'RETURNED') row.returned = r3(row.returned + q)
    row.left = r3(row.received - row.used - row.returned)
    map.set(key, row)
  }
  return [...map.values()]
}

export async function addEntry(orderId: number, input: BrandClothInput, user: string) {
  const order = await prisma.brandOrder.findUnique({ where: { id: orderId } })
  if (!order) throw ApiError.notFound('Brand order not found')
  if (order.status === 'CANCELLED') throw ApiError.conflict(`${order.docNo} is cancelled`)
  const { date, isFuture } = toDocDate(input.date)
  if (isFuture) throw ApiError.badRequest("Date can't be in the future")
  await prisma.$transaction(async (tx) => {
    const e = await tx.brandClothEntry.create({ data: { orderId, brandId: order.brandId, date, kind: input.kind, description: input.description, qty: input.qty, unit: input.unit, notes: input.notes, createdBy: user } })
    await audit(tx, { actor: user, action: 'brandCloth.add', entity: 'brandOrder', entityId: orderId, summary: `${order.docNo}: brand cloth ${KIND[e.kind]} — ${input.qty} ${input.unit} ${input.description}` })
  })
  return listEntries(orderId)
}

// Entries are notes, not money or stock — a wrong one is simply removed (logged).
export async function removeEntry(orderId: number, entryId: number, user: string) {
  const e = await prisma.brandClothEntry.findFirst({ where: { id: entryId, orderId }, include: { order: { select: { docNo: true } } } })
  if (!e) throw ApiError.notFound('Cloth entry not found')
  await prisma.$transaction(async (tx) => {
    await tx.brandClothEntry.delete({ where: { id: entryId } })
    await audit(tx, { actor: user, action: 'brandCloth.remove', entity: 'brandOrder', entityId: orderId, summary: `${e.order.docNo}: removed cloth entry — ${KIND[e.kind]} ${e.qty} ${e.unit} ${e.description}` })
  })
  return listEntries(orderId)
}
