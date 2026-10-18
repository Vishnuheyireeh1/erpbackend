// Pure purchase-bill maths (no database). Same rules are mirrored on the frontend for the live preview,
// but the server ALWAYS recalculates — totals sent by the browser are never trusted.
//
// Order (as on supplier bills): items − line discount − bill / cash discount (spread) = taxable → GST per item
// + other charges (packing …) with their own GST % → round off = bill total.
// Freight paid separately to a transporter is NOT part of this bill — it only raises the items' stock cost.

export type CalcLineInput = { qty: number; rate: number; discountPct: number; gstRate: number }

export type CalcInput = {
  lines: CalcLineInput[]
  billDiscountPct?: number // cash discount % on the whole bill …
  billDiscount?: number // … or a fixed ₹ amount (used when no % is given)
  otherCharges: number // packing, forwarding … on the supplier's bill
  chargesGstRate?: number // GST % the supplier added on those charges (0 = none)
  freightSeparate?: number // paid to the transporter ("To pay") — cost only
  taxMode: 'INTRA' | 'INTER'
  gstRegistered: boolean // false → GST can't be claimed back, so it becomes part of the stock cost
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000

// Spreads an amount over values by their share; the last one takes the rounding remainder.
function spread(total: number, weights: number[]) {
  const sum = weights.reduce((s, w) => s + w, 0)
  let given = 0
  return weights.map((w, i) => {
    if (i === weights.length - 1) return r2(total - given)
    const share = sum > 0 ? r2((total * w) / sum) : 0
    given = r2(given + share)
    return share
  })
}

const split = (tax: number, taxMode: 'INTRA' | 'INTER') => {
  const cgst = taxMode === 'INTRA' ? r2(tax / 2) : 0
  return { cgst, sgst: taxMode === 'INTRA' ? r2(tax - cgst) : 0, igst: taxMode === 'INTER' ? tax : 0 }
}

export function calcPurchase(input: CalcInput) {
  const afterLine = input.lines.map((l) => {
    const gross = l.qty * l.rate
    return r2(gross - (gross * l.discountPct) / 100)
  })
  const itemsTotal = r2(afterLine.reduce((s, a) => s + a, 0))
  const billDiscount = Math.min(itemsTotal, r2(input.billDiscountPct ? (itemsTotal * input.billDiscountPct) / 100 : (input.billDiscount ?? 0)))
  const discountShares = spread(billDiscount, afterLine)

  const lines = input.lines.map((l, i) => {
    const taxable = r2(afterLine[i] - discountShares[i])
    const tax = r2((taxable * l.gstRate) / 100)
    return { taxable, tax, ...split(tax, input.taxMode), lineTotal: r2(taxable + tax) }
  })

  const otherCharges = r2(input.otherCharges)
  const chargesTax = r2((otherCharges * (input.chargesGstRate ?? 0)) / 100)
  const chargesSplit = split(chargesTax, input.taxMode)
  const taxableTotal = r2(lines.reduce((s, l) => s + l.taxable, 0))

  // Stock cost: item value + share of charges and separate freight (+ GST when it can't be claimed back).
  const extra = r2(otherCharges + (input.freightSeparate ?? 0) + (input.gstRegistered ? 0 : chargesTax))
  const extraShares = spread(extra, lines.map((l) => l.taxable))
  const withCost = lines.map((l, i) => {
    const qty = input.lines[i].qty
    const costTotal = l.taxable + extraShares[i] + (input.gstRegistered ? 0 : l.tax)
    return { ...l, unitCost: qty > 0 ? r4(costTotal / qty) : 0 }
  })

  const cgstTotal = r2(lines.reduce((s, l) => s + l.cgst, 0) + chargesSplit.cgst)
  const sgstTotal = r2(lines.reduce((s, l) => s + l.sgst, 0) + chargesSplit.sgst)
  const igstTotal = r2(lines.reduce((s, l) => s + l.igst, 0) + chargesSplit.igst)
  const raw = r2(taxableTotal + cgstTotal + sgstTotal + igstTotal + otherCharges)
  const grandTotal = Math.round(raw)
  return {
    lines: withCost,
    billDiscount,
    taxableTotal,
    cgstTotal,
    sgstTotal,
    igstTotal,
    otherCharges,
    chargesTax,
    roundOff: r2(grandTotal - raw),
    grandTotal,
  }
}
