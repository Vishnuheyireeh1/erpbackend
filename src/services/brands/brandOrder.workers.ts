import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import { toDocDate } from '../../utils/financialYear'
import type { BrandWorkersInput } from '../../validators/brandOrder.validator'
import { audit } from '../audit.service'
import { lockOpenOrder } from './brandOrder.rules'

// Brand order page → "Assign workers" (same as stitching jobs): per piece, who stitches it and who did each other work
// (Cutting, Embroidery …). Per-piece people get pay; salaried people are only recorded. Other work is kept as the piece's
// worker lines in brand_order_costs, so it counts in the order's profit and the worker's balance. Delivered pieces don't change.

const r2 = (n: number) => Math.round(n * 100) / 100

export async function setWorkers(orderId: number, input: BrandWorkersInput, user: string) {
  const ids = [...new Set(input.items.flatMap((i) => [i.tailorId, ...i.works.map((w) => w.tailorId)]).filter((v): v is number => !!v))]
  const workers = await prisma.tailor.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, isActive: true, payType: true } })
  const today = toDocDate(undefined).date
  const cutting = await prisma.jobCostCategory.findFirst({ where: { name: { equals: 'Cutting', mode: 'insensitive' } }, select: { id: true } })

  await prisma.$transaction(async (tx) => {
    const order = await lockOpenOrder(tx, orderId)
    const items = await tx.brandOrderItem.findMany({ where: { orderId }, select: { id: true, description: true, stage: true, tailorId: true, qty: true } })
    const old = await tx.brandOrderCost.findMany({ where: { orderId, itemId: { in: input.items.map((i) => i.id) }, tailorId: { not: null }, paidBy: { in: ['WORKER', 'SALARIED'] } } })
    const person = (id: number, keep: boolean) => {
      const w = workers.find((x) => x.id === id)
      if (!w) throw ApiError.badRequest('Choose the worker again — reload the order')
      if (!w.isActive && !keep) throw ApiError.badRequest(`${w.name} is inactive`)
      return w
    }
    const changes: string[] = []
    for (const i of input.items) {
      const item = items.find((x) => x.id === i.id)
      if (!item) throw ApiError.badRequest('A piece is not part of this order — reload the page')
      if (item.stage === 'DELIVERED') throw ApiError.badRequest(`${item.description} is already delivered — it can't be changed`)
      const tailor = i.tailorId ? person(i.tailorId, item.tailorId === i.tailorId) : null
      await tx.brandOrderItem.update({ where: { id: i.id }, data: { tailorId: tailor?.id ?? null, labourRate: tailor?.payType === 'PIECE' ? i.labourRate : 0 } })
      const before = old.filter((c) => c.itemId === i.id)
      await tx.brandOrderCost.deleteMany({ where: { id: { in: before.map((c) => c.id) } } })
      for (const w of i.works) {
        const prev = before.find((c) => c.categoryId === w.categoryId)
        const by = person(w.tailorId, prev?.tailorId === w.tailorId)
        // A salaried cutting master with a pay typed: extra pay on top of salary.
        const owed = by.payType === 'PIECE' || (w.categoryId === cutting?.id && w.rate > 0)
        const rate = owed ? w.rate : 0
        await tx.brandOrderCost.create({
          data: { orderId, itemId: i.id, categoryId: w.categoryId, tailorId: by.id, date: prev?.date ?? today, description: prev?.description ?? null, qty: item.qty, rate, amount: r2(item.qty * rate), paidBy: owed ? 'WORKER' : 'SALARIED', createdBy: prev?.createdBy ?? user },
        })
      }
      changes.push(`${item.description}: ${tailor?.name ?? 'no tailor'}${i.works.length ? ` + ${i.works.length} other work` : ''}`)
    }
    await audit(tx, { actor: user, action: 'brandOrder.workers', entity: 'brandOrder', entityId: orderId, summary: `${order.docNo} workers — ${changes.join('; ')}`.slice(0, 250) })
  })
}
