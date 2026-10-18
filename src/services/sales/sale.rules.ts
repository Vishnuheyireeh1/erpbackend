import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import type { Tender } from '../../validators/sales.validator'

const r2 = (n: number) => Math.round(n * 100) / 100

export type SaleItem = { description: string; hsnCode: string | null; gstRate: number; isService: boolean }

// Items on the bill, with what the calculation and the printed bill need.
export async function loadSaleItems(variantIds: number[]) {
  const ids = [...new Set(variantIds)]
  const rows = await prisma.productVariant.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, sku: true, isActive: true,
      size: { select: { name: true } },
      colour: { select: { name: true } },
      product: { select: { name: true, type: true, hsnCode: true, isActive: true, taxRate: { select: { rate: true } } } },
    },
  })
  if (rows.length !== ids.length) throw ApiError.badRequest('An item on the bill no longer exists')
  const map = new Map<number, SaleItem>()
  for (const v of rows) {
    if (!v.isActive || !v.product.isActive) throw ApiError.badRequest(`${v.sku} is inactive — it can't be sold`)
    map.set(v.id, {
      description: [v.product.name, v.size?.name, v.colour?.name].filter(Boolean).join(' · ').slice(0, 200),
      hsnCode: v.product.hsnCode,
      gstRate: Number(v.product.taxRate?.rate ?? 0),
      isService: v.product.type === 'SERVICE',
    })
  }
  return map
}

// Money handed over → what is kept, change to return, and the tenders to record.
// Change can only come out of cash (you don't give change for a UPI / card overpayment).
export function splitTenders(tenders: Tender[], grandTotal: number) {
  const cash = r2(tenders.filter((t) => t.mode === 'CASH').reduce((s, t) => s + t.amount, 0))
  const other = r2(tenders.filter((t) => t.mode !== 'CASH').reduce((s, t) => s + t.amount, 0))
  if (other > grandTotal + 0.004) throw ApiError.badRequest(`UPI / card amounts (₹${other}) are more than the bill (₹${grandTotal})`)
  const total = r2(cash + other)
  const change = Math.max(0, r2(total - grandTotal))
  const applied = r2(total - change)
  // Record cash as the amount kept (tendered − change), one tender per mode.
  const kept: Tender[] = []
  const keptCash = r2(cash - change)
  if (keptCash > 0) kept.push({ mode: 'CASH', amount: keptCash, reference: null })
  kept.push(...tenders.filter((t) => t.mode !== 'CASH'))
  return { applied, change, cashTendered: cash, tenders: kept }
}
