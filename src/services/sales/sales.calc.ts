// Pure sales-bill maths (no database). Selling prices INCLUDE GST — tax is worked out backwards.
// The frontend has a copy for the live preview; the server always recalculates on save.

export type SaleCalcLine = { qty: number; rate: number; discountPct: number; productGstRate: number; hsnCode: string | null }

export type SaleCalcInput = {
  lines: SaleCalcLine[]
  billDiscount: number // ₹ off the whole bill, spread over the lines
  taxMode: 'INTRA' | 'INTER'
  gstRegistered: boolean
  apparelRule: boolean // clothing (HSN 61 / 62): 5% up to ₹2,500 per piece, 18% above
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
export const APPAREL_LIMIT = 2500

export function isApparel(hsn: string | null) {
  return !!hsn && (hsn.startsWith('61') || hsn.startsWith('62'))
}

// GST % for one line, given its final GST-inclusive amount.
export function gstRateFor(line: SaleCalcLine, amount: number, input: Pick<SaleCalcInput, 'gstRegistered' | 'apparelRule'>) {
  if (!input.gstRegistered) return 0
  if (input.apparelRule && isApparel(line.hsnCode) && line.qty > 0) {
    const perPieceTaxableAt5 = amount / line.qty / 1.05
    return perPieceTaxableAt5 <= APPAREL_LIMIT ? 5 : 18
  }
  return line.productGstRate
}

export function calcSale(input: SaleCalcInput) {
  const afterLine = input.lines.map((l) => r2(l.qty * l.rate * (1 - l.discountPct / 100)))
  const sumAfterLine = r2(afterLine.reduce((s, a) => s + a, 0))
  const billDiscount = Math.min(r2(input.billDiscount), sumAfterLine)

  // Spread the bill discount by amount; the last line takes the rounding remainder.
  let spread = 0
  const amounts = afterLine.map((a, i) => {
    if (i === afterLine.length - 1) return r2(a - (billDiscount - spread))
    const share = sumAfterLine > 0 ? r2((billDiscount * a) / sumAfterLine) : 0
    spread = r2(spread + share)
    return r2(a - share)
  })

  const lines = input.lines.map((l, i) => {
    const amount = amounts[i]
    const gstRate = gstRateFor(l, amount, input)
    const taxable = r2((amount * 100) / (100 + gstRate))
    const tax = r2(amount - taxable)
    const cgst = input.taxMode === 'INTRA' ? r2(tax / 2) : 0
    const sgst = input.taxMode === 'INTRA' ? r2(tax - cgst) : 0
    const igst = input.taxMode === 'INTER' ? tax : 0
    return { amount, gstRate, taxable, cgst, sgst, igst }
  })

  const grossTotal = r2(input.lines.reduce((s, l) => s + l.qty * l.rate, 0))
  const net = r2(lines.reduce((s, l) => s + l.amount, 0))
  const grandTotal = Math.round(net)
  return {
    lines,
    grossTotal,
    discountTotal: r2(grossTotal - net),
    taxableTotal: r2(lines.reduce((s, l) => s + l.taxable, 0)),
    cgstTotal: r2(lines.reduce((s, l) => s + l.cgst, 0)),
    sgstTotal: r2(lines.reduce((s, l) => s + l.sgst, 0)),
    igstTotal: r2(lines.reduce((s, l) => s + l.igst, 0)),
    roundOff: r2(grandTotal - net),
    grandTotal,
  }
}
