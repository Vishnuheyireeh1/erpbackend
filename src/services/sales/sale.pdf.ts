import { gstStates } from '../../utils/gst'
import { hr, inr, newDoc, num, para, text, toBuffer, type Doc } from '../../utils/pdf'
import { getSetting } from '../settings.service'
import { getSale } from './sale.query'

type Sale = Awaited<ReturnType<typeof getSale>>
const L = 36
const R = 559 // A4 width 595 − margin

// Columns: Sl | Item | HSN | Qty | Rate | Disc | GST | Amount
const COLS = [
  { key: 'sl', x: L, w: 22, label: '#' },
  { key: 'item', x: 58, w: 200, label: 'Item' },
  { key: 'hsn', x: 260, w: 44, label: 'HSN' },
  { key: 'qty', x: 304, w: 46, label: 'Qty', right: true },
  { key: 'rate', x: 352, w: 62, label: 'Rate', right: true },
  { key: 'disc', x: 416, w: 34, label: 'Disc', right: true },
  { key: 'gst', x: 452, w: 30, label: 'GST', right: true },
  { key: 'amt', x: 484, w: 75, label: 'Amount', right: true },
]

function header(doc: Doc, sale: Sale, p: Awaited<ReturnType<typeof getSetting<'business.profile'>>>) {
  para(doc, p.shopName.toUpperCase(), L, 36, R - L, { size: 16, bold: true, align: 'center' })
  const addr = [p.addressLine1, p.addressLine2, [p.city, p.pincode].filter(Boolean).join(' - ')].filter(Boolean).join(', ')
  let y = para(doc, addr || ' ', L, doc.y + 2, R - L, { size: 9, align: 'center', color: '#444444' })
  const contact = [p.phone && `Ph: ${p.phone}`, p.email, p.gstin && `GSTIN: ${p.gstin}`].filter(Boolean).join('   ·   ')
  if (contact) y = para(doc, contact, L, y + 1, R - L, { size: 9, align: 'center', color: '#444444' })
  y += 8
  para(doc, p.gstRegistered ? 'TAX INVOICE' : 'BILL OF SUPPLY', L, y, R - L, { size: 11, bold: true, align: 'center' })
  y = doc.y + 6
  hr(doc, y)
  y += 8
  text(doc, `Bill No: ${sale.docNo}${sale.bookNo ? `   (SJ No: ${sale.bookNo})` : ''}`, L, y, { bold: true })
  text(doc, `Date: ${sale.docDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}  ${sale.createdAt.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}`, 330, y, { width: R - 330, align: 'right' })
  y += 14
  text(doc, `Customer: ${sale.customerName}${sale.customerPhone ? `  ·  ${sale.customerPhone}` : ''}`, L, y)
  if (sale.customerGstin) text(doc, `GSTIN: ${sale.customerGstin} (${gstStates[sale.customerGstin.slice(0, 2)] ?? ''})`, 330, y, { width: R - 330, align: 'right' })
  return y + 18
}

// Line amount = qty × rate − line discount; the bill discount is shown once in the totals.
const lineAmt = (l: Sale['lines'][number]) => Math.round(Number(l.qty) * Number(l.rate) * (1 - Number(l.discountPct) / 100) * 100) / 100

function table(doc: Doc, sale: Sale, top: number) {
  let y = top
  doc.rect(L, y - 3, R - L, 16).fill('#f2f2f2')
  for (const c of COLS) text(doc, c.label, c.x, y, { bold: true, width: c.w, align: c.right ? 'right' : 'left', size: 8.5 })
  y += 17
  sale.lines.forEach((l, i) => {
    if (y > 740) { doc.addPage(); y = 50 }
    const unit = l.variant.product.unit.code
    const desc = l.description.length > 44 ? `${l.description.slice(0, 43)}…` : l.description
    const cells: Record<string, string> = {
      sl: String(i + 1), item: desc, hsn: l.hsnCode ?? '', qty: `${num(l.qty, 3)} ${unit}`, rate: num(l.rate),
      disc: Number(l.discountPct) ? `${num(l.discountPct, 1)}%` : '', gst: `${num(l.gstRate, 1)}%`, amt: num(lineAmt(l)),
    }
    for (const c of COLS) text(doc, cells[c.key], c.x, y, { width: c.w, align: c.right ? 'right' : 'left', size: 8.5 })
    y += 15
  })
  hr(doc, y)
  return y + 8
}

function totals(doc: Doc, sale: Sale, top: number, gstRegistered: boolean) {
  let y = top
  const row = (label: string, value: string, bold = false) => {
    text(doc, label, 360, y, { bold, width: 110 })
    text(doc, value, 470, y, { bold, width: R - 470, align: 'right' })
    y += bold ? 16 : 13
  }
  const subtotal = sale.lines.reduce((s, l) => s + lineAmt(l), 0)
  const billDisc = Math.round((subtotal - (Number(sale.grandTotal) - Number(sale.roundOff))) * 100) / 100
  if (billDisc > 0.004) { row('Sub total', inr(subtotal)); row('Discount', `− ${inr(billDisc)}`) }
  if (Number(sale.roundOff)) row('Round off', `${Number(sale.roundOff) > 0 ? '+' : '−'} ${inr(Math.abs(Number(sale.roundOff)))}`)
  row('TOTAL', inr(sale.grandTotal), true)
  row('Paid', inr(sale.paidAmount))
  if (Number(sale.returnedAmount) > 0) row('Returned', inr(sale.returnedAmount))
  row('BALANCE', inr(sale.dueAmount), true)

  // GST breakup by rate (left side), only when registered.
  let gy = top
  if (gstRegistered) {
    const byRate = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>()
    for (const l of sale.lines) {
      const r = byRate.get(Number(l.gstRate)) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 }
      r.taxable += Number(l.taxable); r.cgst += Number(l.cgst); r.sgst += Number(l.sgst); r.igst += Number(l.igst)
      byRate.set(Number(l.gstRate), r)
    }
    const heads = sale.taxMode === 'INTRA' ? ['Taxable', 'CGST', 'SGST'] : ['Taxable', 'IGST']
    text(doc, 'GST %', L, gy, { bold: true, size: 8 })
    heads.forEach((h, i) => text(doc, h, L + 34 + i * 62, gy, { bold: true, size: 8, width: 56, align: 'right' }))
    gy += 12
    for (const [rate, r] of byRate) {
      const cols = sale.taxMode === 'INTRA' ? [num(r.taxable), num(r.cgst), num(r.sgst)] : [num(r.taxable), num(r.igst)]
      text(doc, `${rate}%`, L, gy, { size: 8 })
      cols.forEach((v, i) => text(doc, v, L + 34 + i * 62, gy, { size: 8, width: 56, align: 'right' }))
      gy += 11
    }
  }
  y = Math.max(y, gy) + 6
  hr(doc, y)
  text(doc, `Rupees ${sale.amountInWords}`, L, y + 8, { bold: true, size: 9 })
  return y + 26
}

// A4 PDF of a sales bill (download / WhatsApp / email).
export async function salePdf(id: number) {
  const [sale, profile] = await Promise.all([getSale(id), getSetting('business.profile')])
  const doc = newDoc('A4')
  let y = header(doc, sale, profile)
  y = table(doc, sale, y)
  y = totals(doc, sale, y, profile.gstRegistered)
  if (sale.status === 'CANCELLED') text(doc, `CANCELLED — ${sale.cancelReason ?? ''}`, L, y + 4, { bold: true, color: '#b5121b', size: 11 })
  if (sale.notes) para(doc, `Note: ${sale.notes}`, L, y + 22, R - L, { size: 8.5, color: '#444444' })
  para(doc, 'Thank you for shopping with us!', L, 790, R - L, { size: 9, align: 'center', color: '#666666' })
  return { buffer: await toBuffer(doc), fileName: `${sale.docNo.replace(/\//g, '-')}.pdf` }
}
