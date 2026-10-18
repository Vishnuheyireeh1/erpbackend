// Pure stitching-job maths (no database). All charges INCLUDE GST; tax is worked out backwards.
// Two parts on one JOB bill:
//   stitching = garments + extra-cost charges − job discount, taxed at the job's GST rate (0 = no GST)
//   items     = shop items SOLD on the job — each line already priced and taxed like the counter (job.items.ts)

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

type Input = {
  items: { qty: number; chargeRate: number; labourRate: number }[]
  materials: { qty: number; unitCost: number; included: boolean; amount: number; taxable: number; cgst: number; sgst: number; igst: number }[]
  costs: { charge: number }[] // extra charges on the bill
  entries?: { amount: number }[] // job cost entries (what the shop spends; not on the bill)
  discount: number
  gstRate: number
  taxMode: 'INTRA' | 'INTER'
}

type MaterialRow = { qty: unknown; unitCost: unknown; included: boolean; amount: unknown; taxable: unknown; cgst: unknown; sgst: unknown; igst: unknown }
export const materialForCalc = (m: MaterialRow) => ({
  qty: Number(m.qty), unitCost: Number(m.unitCost), included: m.included, amount: Number(m.amount),
  taxable: Number(m.taxable), cgst: Number(m.cgst), sgst: Number(m.sgst), igst: Number(m.igst),
})

export function calcJob(input: Input) {
  const stitchCharges = r2(input.items.reduce((s, i) => s + i.qty * i.chargeRate, 0) + input.costs.reduce((s, c) => s + c.charge, 0))
  const discount = Math.min(r2(input.discount), stitchCharges)
  const stitchNet = r2(stitchCharges - discount)
  const stitchTaxable = r2((stitchNet * 100) / (100 + input.gstRate))
  const stitchTax = r2(stitchNet - stitchTaxable)

  const sold = input.materials.filter((m) => !m.included)
  const itemsTotal = r2(sold.reduce((s, m) => s + m.amount, 0))
  const sum = (f: (m: (typeof sold)[number]) => number) => r2(sold.reduce((s, m) => s + f(m), 0))

  const cgstStitch = input.taxMode === 'INTRA' ? r2(stitchTax / 2) : 0
  const net = r2(stitchNet + itemsTotal)
  const grandTotal = Math.round(net)

  // Job costing = the STITCHING only (owner's choice): stitching charged (before GST, after discount) − tailor pay −
  // job work / costs − cloth used FREE for the stitching (stock cost). Items the customer pays for are a shop sale on
  // the same bill → shown apart as "items sold" (their own profit), not in the job's profit.
  const materialCost = r2(input.materials.filter((m) => m.included).reduce((s, m) => s + m.qty * m.unitCost, 0))
  const labourCost = r2(input.items.reduce((s, i) => s + i.qty * i.labourRate, 0))
  const otherCost = r2((input.entries ?? []).reduce((s, e) => s + e.amount, 0))
  const costTotal = r2(materialCost + labourCost + otherCost)
  const soldTaxable = sum((m) => m.taxable)
  const soldCost = sum((m) => m.qty * m.unitCost)
  const taxableTotal = r2(stitchTaxable + soldTaxable)

  return {
    chargeTotal: r2(stitchCharges + itemsTotal),
    discount,
    taxableTotal,
    cgstTotal: r2(cgstStitch + sum((m) => m.cgst)),
    sgstTotal: r2((input.taxMode === 'INTRA' ? r2(stitchTax - cgstStitch) : 0) + sum((m) => m.sgst)),
    igstTotal: r2((input.taxMode === 'INTER' ? stitchTax : 0) + sum((m) => m.igst)),
    roundOff: r2(grandTotal - net),
    grandTotal,
    itemsTotal, // sold items (must be paid in full when added)
    cost: {
      charged: stitchTaxable, chargedGst: stitchTax, materialCost, labourCost, otherCost, costTotal, profit: r2(stitchTaxable - costTotal),
      sold: { taxable: soldTaxable, cost: soldCost, profit: r2(soldTaxable - soldCost) }, // items the customer paid for
    },
  }
}
