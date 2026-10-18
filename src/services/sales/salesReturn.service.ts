import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import { nextDocNo, toDocDate } from '../../utils/financialYear'
import type { SalesReturnInput } from '../../validators/sales.validator'
import { audit } from '../audit.service'
import { postMovements } from '../inventory/stock.engine'
import { getSetting } from '../settings.service'
import { addReturnedAmount, addReturnedQty, loadSource, lockDue } from './returnSource'

const r2 = (n: number) => Math.round(n * 100) / 100
const TX = { timeout: 60_000 }

// Customer returns goods (from a counter bill or items sold on a job): stock back IN at the cost it went out at.
// The value first clears what is still due on that bill / job; the rest is refunded or kept as credit (customers only).
export async function createSalesReturn(input: SalesReturnInput, user: string) {
  const { date, isFuture } = toDocDate(input.docDate)
  if (isFuture) throw ApiError.badRequest("Return date can't be in the future")
  const src = await loadSource(input)
  if (!input.refundMode && !src.customerId) throw ApiError.badRequest('Walk-in bill: choose how the money is refunded')

  const seen = new Set<number>()
  const lines = input.lines.map((r) => {
    const line = src.lines.get((src.kind === 'INV' ? r.salesLineId : r.jobMaterialId)!)
    if (!line) throw ApiError.badRequest(`A returned item is not on ${src.docNo}`)
    if (seen.has(line.id)) throw ApiError.badRequest('The same item is listed twice')
    seen.add(line.id)
    const left = line.qty - line.returnedQty
    if (r.qty > left + 0.0005) throw ApiError.badRequest(`Only ${left} of "${line.description}" can still be returned`)
    const share = r.qty / line.qty
    const total = r2(line.amount * share)
    const taxable = r2(line.taxable * share)
    return { line, qty: r.qty, total, taxable, tax: r2(total - taxable) }
  })
  const grandTotal = r2(lines.reduce((s, l) => s + l.total, 0))
  const allowNegative = await getSetting('inventory.allowNegativeStock')

  const id = await prisma.$transaction(async (tx) => {
    const billCleared = r2(Math.min(grandTotal, await lockDue(tx, src)))
    const refundAmount = input.refundMode ? r2(grandTotal - billCleared) : 0
    const docNo = await nextDocNo(tx, 'SR', date)
    const ret = await tx.salesReturn.create({
      data: {
        docNo, customerId: src.customerId, invoiceId: src.kind === 'INV' ? src.id : null, jobId: src.kind === 'JOB' ? src.id : null,
        docDate: date, reason: input.reason, taxableTotal: r2(lines.reduce((s, l) => s + l.taxable, 0)), taxTotal: r2(lines.reduce((s, l) => s + l.tax, 0)),
        grandTotal, refundMode: input.refundMode, refundAmount, billCleared, createdBy: user,
      },
    })
    await tx.salesReturnLine.createMany({
      data: lines.map((l) => ({
        returnId: ret.id, ...(src.kind === 'INV' ? { salesLineId: l.line.id } : { jobMaterialId: l.line.id }),
        variantId: l.line.variantId, qty: l.qty, taxable: l.taxable, tax: l.tax, total: l.total, unitCost: l.line.unitCost,
      })),
    })
    await postMovements(
      tx,
      lines.filter((l) => !l.line.isService).map((l) => ({ variantId: l.line.variantId, qty: l.qty, unitCost: l.line.unitCost, type: 'SALE_RETURN' as const, note: input.reason })),
      { refType: 'SR', refId: ret.id, refNo: docNo, date, user, allowNegative },
    )
    for (const l of lines) await addReturnedQty(tx, src.kind, l.line.id, l.qty)
    await addReturnedAmount(tx, src.kind, src.id, billCleared)
    const credit = !input.refundMode && grandTotal > billCleared ? `, credit ₹${r2(grandTotal - billCleared)}` : ''
    await audit(tx, { actor: user, action: 'sales_return.post', entity: 'sales_return', entityId: ret.id, summary: `${docNo} against ${src.docNo} — ₹${grandTotal}${refundAmount ? `, refund ₹${refundAmount} ${input.refundMode}` : ''}${credit}` })
    return ret.id
  }, TX)
  return getSalesReturn(id)
}

// Cancel = the goods go back out of stock and the bill's / job's due goes up again.
export async function cancelSalesReturn(id: number, reason: string, user: string) {
  const ret = await prisma.salesReturn.findUnique({ where: { id }, include: { lines: true } })
  if (!ret) throw ApiError.notFound('Sales return not found')
  if (ret.status === 'CANCELLED') throw ApiError.conflict(`${ret.docNo} is already cancelled`)
  if (Number(ret.creditUsed) > 0) throw ApiError.conflict(`₹${ret.creditUsed} of this return's credit was used on a later bill / job — cancel that first`)
  const services = await prisma.productVariant.findMany({ where: { id: { in: ret.lines.map((l) => l.variantId) }, product: { type: 'SERVICE' } }, select: { id: true } })
  const serviceIds = new Set(services.map((s) => s.id))
  const allowNegative = await getSetting('inventory.allowNegativeStock')
  await prisma.$transaction(async (tx) => {
    const done = await tx.salesReturn.updateMany({ where: { id, status: 'POSTED', creditUsed: 0 }, data: { status: 'CANCELLED', cancelledBy: user, cancelledAt: new Date(), cancelReason: reason } })
    if (done.count === 0) throw ApiError.conflict(`${ret.docNo} changed meanwhile — reload and try again`)
    await postMovements(
      tx,
      ret.lines.filter((l) => !serviceIds.has(l.variantId)).map((l) => ({ variantId: l.variantId, qty: -Number(l.qty), unitCost: Number(l.unitCost), type: 'CANCELLATION' as const, note: `Cancelled ${ret.docNo}: ${reason}` })),
      { refType: 'SR', refId: ret.id, refNo: ret.docNo, date: toDocDate(undefined).date, user, allowNegative },
    )
    for (const l of ret.lines) {
      if (l.salesLineId) await tx.salesLine.update({ where: { id: l.salesLineId }, data: { returnedQty: { decrement: l.qty } } })
      else await tx.jobMaterial.update({ where: { id: l.jobMaterialId! }, data: { returnedQty: { decrement: l.qty } } })
    }
    await addReturnedAmount(tx, ret.invoiceId ? 'INV' : 'JOB', (ret.invoiceId ?? ret.jobId)!, -Number(ret.billCleared))
    await audit(tx, { actor: user, action: 'sales_return.cancel', entity: 'sales_return', entityId: id, summary: `${ret.docNo} cancelled — ${reason}` })
  }, TX)
  return getSalesReturn(id)
}

export async function getSalesReturn(id: number) {
  const ret = await prisma.salesReturn.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true } },
      invoice: { select: { id: true, docNo: true, customerName: true } },
      job: { select: { id: true, docNo: true, customerName: true } },
      lines: { orderBy: { id: 'asc' }, include: { jobMaterial: { select: { description: true } } } },
    },
  })
  if (!ret) throw ApiError.notFound('Sales return not found')
  const ids = ret.lines.map((l) => l.salesLineId).filter((x): x is number => !!x)
  const salesLines = ids.length ? await prisma.salesLine.findMany({ where: { id: { in: ids } }, select: { id: true, description: true } }) : []
  const desc = new Map(salesLines.map((s) => [s.id, s.description]))
  return {
    ...ret,
    lines: ret.lines.map(({ jobMaterial, ...l }) => ({ ...l, description: l.salesLineId ? (desc.get(l.salesLineId) ?? '') : (jobMaterial?.description ?? '') })),
  }
}
