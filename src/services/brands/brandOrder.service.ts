import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import { nextDocNo, toDocDate } from '../../utils/financialYear'
import type { BrandOrderCreateInput, BrandOrderUpdateInput } from '../../validators/brandOrder.validator'
import { audit } from '../audit.service'
import { getSetting } from '../settings.service'
import { postMaterialsTx, priceMaterials, returnMaterialsTx } from './brandOrder.material'
import { getOrder } from './brandOrder.query'
import { loadPieceRefs, lockOpenOrder, pieceData } from './brandOrder.rules'

// Brand orders: received → pieces stitched (Ready) → delivered on bills (next step). Editable while open;
// delivered pieces stay as they are. Cloth from our stock leaves stock when it is added.

const TX = { timeout: 30_000, maxWait: 20_000 }
const pieces = (n: number) => `${n} piece${n === 1 ? '' : 's'}`

export async function createOrder(input: BrandOrderCreateInput, user: string) {
  const { date, isFuture } = toDocDate(input.docDate)
  if (isFuture) throw ApiError.badRequest("Received date can't be in the future")
  if (input.expectedDate < date.toISOString().slice(0, 10)) throw ApiError.badRequest('Due date is before the received date')
  const brand = await prisma.partnerBrand.findUnique({ where: { id: input.brandId } })
  if (!brand) throw ApiError.badRequest('Selected brand no longer exists')
  if (!brand.isActive) throw ApiError.badRequest(`Brand "${brand.name}" is inactive`)
  const refs = await loadPieceRefs(input.items)
  const priced = await Promise.all(input.items.map((i) => priceMaterials(i.materials)))
  const allowNegative = await getSetting('inventory.allowNegativeStock')

  const id = await prisma.$transaction(async (tx) => {
    const docNo = await nextDocNo(tx, 'BRO', date)
    const order = await tx.brandOrder.create({
      data: {
        docNo, brandId: brand.id, brandName: brand.name, theirOrderNo: input.theirOrderNo, docDate: date,
        expectedDate: new Date(`${input.expectedDate}T00:00:00Z`), labelNote: input.labelNote, notes: input.notes, createdBy: user,
      },
    })
    for (const [k, i] of input.items.entries()) {
      const item = await tx.brandOrderItem.create({ data: { ...pieceData(i, k, refs), orderId: order.id } })
      await postMaterialsTx(tx, order, item.id, priced[k], { user, date, allowNegative })
    }
    const count = input.items.reduce((s, i) => s + i.qty, 0)
    await audit(tx, { actor: user, action: 'brandOrder.create', entity: 'brandOrder', entityId: order.id, summary: `${docNo} — ${brand.name}${input.theirOrderNo ? ` (order / bill no. ${input.theirOrderNo})` : ''}, ${pieces(count)}, due ${input.expectedDate}` })
    return order.id
  }, TX)
  return getOrder(id)
}

// Edit an open order. Delivered pieces can't change or be removed; a removed piece's stock items go back to stock.
// Items of existing pieces are changed on the order page (add / take off); new pieces may bring their items.
export async function updateOrder(id: number, input: BrandOrderUpdateInput, user: string) {
  const current = await prisma.brandOrder.findUnique({ where: { id }, include: { items: { include: { materials: { select: { id: true } } } } } })
  if (!current) throw ApiError.notFound('Brand order not found')
  const byId = new Map(current.items.map((i) => [i.id, i]))
  for (const i of input.items) {
    const old = i.id ? byId.get(i.id) : undefined
    if (i.id && !old) throw ApiError.badRequest('A piece is not part of this order — reload the page')
    if (old?.stage === 'DELIVERED') throw ApiError.badRequest(`${old.description} is already delivered — it can't be changed`)
  }
  const keep = new Set(input.items.map((i) => i.id).filter(Boolean))
  const delivered = current.items.filter((i) => i.stage === 'DELIVERED')
  const removed = current.items.filter((i) => !keep.has(i.id) && i.stage !== 'DELIVERED')
  if (input.expectedDate < current.docDate.toISOString().slice(0, 10)) throw ApiError.badRequest('Due date is before the received date')
  const refs = await loadPieceRefs(input.items, new Set(byId.keys()))
  const priced = await Promise.all(input.items.map((i) => (i.id ? Promise.resolve([]) : priceMaterials(i.materials))))
  const allowNegative = await getSetting('inventory.allowNegativeStock')
  const { date } = toDocDate(undefined)

  await prisma.$transaction(async (tx) => {
    const order = await lockOpenOrder(tx, id)
    await tx.brandOrder.update({ where: { id }, data: { theirOrderNo: input.theirOrderNo, expectedDate: new Date(`${input.expectedDate}T00:00:00Z`), labelNote: input.labelNote, notes: input.notes } })
    if (removed.length) {
      await returnMaterialsTx(tx, order, removed.flatMap((i) => i.materials.map((m) => m.id)), { user, note: `Piece removed from ${order.docNo}` })
      await tx.brandOrderItem.deleteMany({ where: { id: { in: removed.map((i) => i.id) } } })
    }
    for (const [k, i] of input.items.entries()) {
      const data = pieceData(i, delivered.length + k, refs)
      if (i.id) await tx.brandOrderItem.update({ where: { id: i.id }, data })
      else {
        const item = await tx.brandOrderItem.create({ data: { ...data, orderId: id } })
        await postMaterialsTx(tx, order, item.id, priced[k], { user, date, allowNegative })
      }
    }
    const added = input.items.filter((i) => !i.id).length
    const summary = [`${order.docNo} edited`, added && `${added} piece line(s) added`, removed.length && `${removed.length} removed`].filter(Boolean).join(', ')
    await audit(tx, { actor: user, action: 'brandOrder.update', entity: 'brandOrder', entityId: id, summary })
  }, TX)
  return getOrder(id)
}

// Pieces stitched (Ready → the tailor's per-piece pay is earned today) or back in work. Delivered pieces don't change.
export async function setStage(id: number, itemIds: number[], stage: 'IN_WORK' | 'READY', user: string) {
  const { date } = toDocDate(undefined)
  await prisma.$transaction(async (tx) => {
    const order = await lockOpenOrder(tx, id)
    const items = await tx.brandOrderItem.findMany({ where: { orderId: id, id: { in: itemIds } } })
    if (items.length !== new Set(itemIds).size) throw ApiError.badRequest('A piece is not part of this order — reload the page')
    const done = items.find((i) => i.stage === 'DELIVERED')
    if (done) throw ApiError.badRequest(`${done.description} is already delivered`)
    const change = items.filter((i) => i.stage !== stage)
    if (!change.length) return
    await tx.brandOrderItem.updateMany({ where: { id: { in: change.map((i) => i.id) } }, data: { stage, readyOn: stage === 'READY' ? date : null } })
    const what = change.map((i) => `${i.qty} × ${i.description}${i.endCustomer ? ` (${i.endCustomer})` : ''}`).join(', ')
    await audit(tx, { actor: user, action: 'brandOrder.stage', entity: 'brandOrder', entityId: id, summary: `${order.docNo}: ${stage === 'READY' ? 'ready' : 'back in work'} — ${what}`.slice(0, 250) })
  }, TX)
  return getOrder(id)
}

// Cancel an order nothing of which was delivered: stock items go back, tailor pay of ready pieces is no longer owed.
export async function cancelOrder(id: number, reason: string, user: string) {
  await prisma.$transaction(async (tx) => {
    const order = await lockOpenOrder(tx, id)
    const items = await tx.brandOrderItem.findMany({ where: { orderId: id }, select: { stage: true } })
    if (items.some((i) => i.stage === 'DELIVERED')) throw ApiError.conflict(`${order.docNo} has delivered pieces — it can't be cancelled`)
    const materials = await tx.brandOrderMaterial.findMany({ where: { orderId: id }, select: { id: true } })
    await returnMaterialsTx(tx, order, materials.map((m) => m.id), { user, note: `${order.docNo} cancelled` })
    await tx.brandOrder.update({ where: { id }, data: { status: 'CANCELLED', cancelledBy: user, cancelledAt: new Date(), cancelReason: reason } })
    await audit(tx, { actor: user, action: 'brandOrder.cancel', entity: 'brandOrder', entityId: id, summary: `${order.docNo} cancelled — ${reason}` })
  }, TX)
  return getOrder(id)
}

// Tailor + pay per piece for one piece, from the order page (no full edit). Delivered pieces don't change.
export async function setPieceTailor(id: number, itemId: number, tailorId: number | null, labourRate: number, user: string) {
  const item = await prisma.brandOrderItem.findFirst({ where: { id: itemId, orderId: id }, include: { order: { select: { docNo: true, status: true } } } })
  if (!item) throw ApiError.notFound('Piece not found')
  if (item.order.status !== 'OPEN') throw ApiError.conflict(`${item.order.docNo} is not open`)
  if (item.stage === 'DELIVERED') throw ApiError.badRequest(`${item.description} is already delivered — it can't be changed`)
  const tailor = tailorId ? await prisma.tailor.findUnique({ where: { id: tailorId }, select: { id: true, name: true, isActive: true } }) : null
  if (tailorId && (!tailor || !tailor.isActive)) throw ApiError.badRequest('Choose the tailor again')
  await prisma.$transaction(async (tx) => {
    await tx.brandOrderItem.update({ where: { id: itemId }, data: { tailorId: tailor?.id ?? null, labourRate: tailor ? labourRate : 0 } })
    await audit(tx, { actor: user, action: 'brandOrder.tailor', entity: 'brandOrder', entityId: id, summary: `${item.order.docNo}: ${item.description} → ${tailor ? `${tailor.name} ₹${labourRate}/pc` : 'no tailor'}` })
  })
}
