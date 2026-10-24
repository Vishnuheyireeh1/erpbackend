import type { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'
import type { JobProductLine } from '../../validators/job.validator'
import type { Tender } from '../../validators/sales.validator'
import { postMovements } from '../inventory/stock.engine'
import { createReceiptTx } from '../sales/receipt.service'
import { loadSaleItems } from '../sales/sale.rules'
import { calcSale } from '../sales/sales.calc'
import { applyAdvanceTx } from '../sales/settle.service'
import { getSetting } from '../settings.service'

// Shop items on a job. SOLD lines are priced like the counter (GST-inclusive, clothing rule) and must be paid in
// full when added; INCLUDED lines are used for the stitching (not billed). Both leave stock at once.

type Tx = Prisma.TransactionClient
const r2 = (n: number) => Math.round(n * 100) / 100

export async function priceLines(lines: JobProductLine[], taxMode: 'INTRA' | 'INTER') {
  if (!lines.length) return []
  const items = await loadSaleItems(lines.map((l) => l.variantId))
  const [profile, apparelRule] = await Promise.all([getSetting('business.profile'), getSetting('billing.apparelGstRule')])
  for (const l of lines) if (l.included && items.get(l.variantId)!.isService) throw ApiError.badRequest('A service has no stock — it can only be sold')
  const sold = lines.filter((l) => !l.included)
  const calc = calcSale({
    lines: sold.map((l) => ({ qty: l.qty, rate: l.rate, discountPct: l.discountPct, productGstRate: items.get(l.variantId)!.gstRate, hsnCode: items.get(l.variantId)!.hsnCode })),
    billDiscount: 0, taxMode, gstRegistered: profile.gstRegistered, apparelRule,
  })
  let k = 0
  return lines.map((l) => {
    const item = items.get(l.variantId)!
    const base = { variantId: l.variantId, description: item.description, hsnCode: item.hsnCode, qty: l.qty, included: l.included, isService: item.isService }
    if (l.included) return { ...base, rate: 0, discountPct: 0, amount: 0, gstRate: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 }
    const c = calc.lines[k++]
    return { ...base, rate: l.rate, discountPct: l.discountPct, amount: c.amount, gstRate: c.gstRate, taxable: c.taxable, cgst: c.cgst, sgst: c.sgst, igst: c.igst }
  })
}
export type PricedLine = Awaited<ReturnType<typeof priceLines>>[number]
export const soldTotal = (lines: PricedLine[]) => r2(lines.filter((l) => !l.included).reduce((s, l) => s + l.amount, 0))

// Stock OUT (SALE for sold goods, JOB_CONSUMPTION for used material; services have no stock) + the job lines.
export async function postLinesTx(tx: Tx, job: { id: number; docNo: string }, lines: PricedLine[], ctx: { user: string; date: Date; allowNegative: boolean }) {
  const goods = lines.map((l, i) => ({ l, i })).filter(({ l }) => !l.isService)
  const moved = await postMovements(
    tx,
    goods.map(({ l }) => ({ variantId: l.variantId, qty: -l.qty, type: l.included ? ('JOB_CONSUMPTION' as const) : ('SALE' as const), note: `${l.included ? 'Used for' : 'Sold on'} ${job.docNo}` })),
    { refType: 'JOB', refId: job.id, refNo: job.docNo, date: ctx.date, user: ctx.user, allowNegative: ctx.allowNegative },
  )
  const cost = new Map(goods.map(({ i }, k) => [i, moved[k].unitCost]))
  await tx.jobMaterial.createMany({
    data: lines.map(({ isService: _s, ...l }, i) => ({ ...l, jobId: job.id, unitCost: cost.get(i) ?? 0, createdBy: ctx.user })),
  })
}

// Money for the job now: optional old advance / credit first, then what is handed over (any amount — the rest is the balance).
export async function takePaymentTx(
  tx: Tx,
  jobId: number,
  p: { itemsDue: number; tenders: Tender[]; useAdvance: boolean; date: Date; user: string; note: string },
) {
  const job = await tx.stitchingJob.findUniqueOrThrow({ where: { id: jobId } })
  const advance = p.useAdvance ? await applyAdvanceTx(tx, job.customerId, 'JOB', jobId, p.user) : 0
  const paid = r2(p.tenders.reduce((s, t) => s + t.amount, 0))
  // Credit: items on a job may also stay on the customer's balance (paid at hand over or later).
  if (paid > 0) {
    const due = r2(Number(job.grandTotal) - Number(job.paidAmount) - Number(job.returnedAmount) - advance)
    const toJob = r2(Math.min(paid, Math.max(0, due)))
    await createReceiptTx(tx, { customerId: job.customerId, docDate: p.date, tenders: p.tenders, notes: p.note, allocations: toJob > 0 ? [{ jobId, amount: toJob }] : [] }, p.user)
  }
  return { advance, paid }
}
