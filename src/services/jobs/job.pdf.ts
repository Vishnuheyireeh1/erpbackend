import { hr, inr, newDoc, num, para, text, toBuffer, type Doc } from '../../utils/pdf'
import { getSetting } from '../settings.service'
import { getJob } from './job.query'

type Job = Awaited<ReturnType<typeof getJob>>
const L = 36
const R = 559
const COLS = [
  { key: 'sl', x: L, w: 22, label: '#' },
  { key: 'item', x: 58, w: 270, label: 'Particulars' },
  { key: 'rate', x: 330, w: 80, label: 'Rate', right: true },
  { key: 'qty', x: 412, w: 50, label: 'Qty', right: true },
  { key: 'amt', x: 464, w: 95, label: 'Amount', right: true },
]
const fmtDate = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })

// Bill lines: stitching (garments, charged extras), then items sold on the job. Used material is not printed.
export function jobBillLines(job: Job) {
  return [
    ...job.items.map((i) => ({ name: i.description, rate: Number(i.chargeRate), qty: String(i.qty), amount: i.qty * Number(i.chargeRate), sold: false })),
    ...job.costs.filter((c) => Number(c.charge) > 0).map((c) => ({ name: c.description ? `${c.kind} (${c.description})` : c.kind, rate: Number(c.charge), qty: '1', amount: Number(c.charge), sold: false })),
    ...job.materials.filter((m) => !m.included).map((m) => ({
      name: `${m.description}${Number(m.discountPct) ? ` (-${Number(m.discountPct)}%)` : ''}${Number(m.returnedQty) > 0 ? ` [${Number(m.returnedQty)} returned]` : ''}`,
      rate: Number(m.rate), qty: String(Number(m.qty)), amount: Number(m.qty) * Number(m.rate) * (1 - Number(m.discountPct) / 100), sold: true,
    })),
  ]
}

function header(doc: Doc, job: Job, p: Awaited<ReturnType<typeof getSetting<'business.profile'>>>) {
  para(doc, p.shopName.toUpperCase(), L, 36, R - L, { size: 16, bold: true, align: 'center' })
  const addr = [p.addressLine1, p.addressLine2, [p.city, p.pincode].filter(Boolean).join(' - ')].filter(Boolean).join(', ')
  let y = para(doc, addr || ' ', L, doc.y + 2, R - L, { size: 9, align: 'center', color: '#444444' })
  const contact = [p.phone && `Ph: ${p.phone}`, p.gstRegistered && p.gstin && `GSTIN: ${p.gstin}`].filter(Boolean).join('   ·   ')
  if (contact) y = para(doc, contact, L, y + 1, R - L, { size: 9, align: 'center', color: '#444444' })
  para(doc, Number(job.gstRate) > 0 ? 'STITCHING JOB · TAX INVOICE' : 'STITCHING JOB BILL', L, y + 8, R - L, { size: 11, bold: true, align: 'center' })
  y = doc.y + 6
  hr(doc, y)
  y += 8
  text(doc, `Job No: ${job.docNo}${job.bookNo ? `   (Book No: ${job.bookNo})` : ''}`, L, y, { bold: true })
  text(doc, `Booked: ${fmtDate(job.docDate)}  ${job.createdAt.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}`, 330, y, { width: R - 330, align: 'right' })
  y += 14
  text(doc, `Customer: ${job.customerName}${job.customerPhone ? `  ·  ${job.customerPhone}` : ''}`, L, y)
  text(doc, `Ready by: ${fmtDate(job.expectedDate)}`, 330, y, { width: R - 330, align: 'right', bold: true })
  return y + 18
}

// A4 PDF of a stitching job bill (download / WhatsApp).
export async function jobPdf(id: number) {
  const [job, profile] = await Promise.all([getJob(id), getSetting('business.profile')])
  const doc = newDoc('A4')
  let y = header(doc, job, profile)
  doc.rect(L, y - 3, R - L, 16).fill('#f2f2f2')
  for (const c of COLS) text(doc, c.label, c.x, y, { bold: true, width: c.w, align: c.right ? 'right' : 'left', size: 8.5 })
  y += 17
  const lines = jobBillLines(job)
  lines.forEach((l, i) => {
    if (y > 740) { doc.addPage(); y = 50 }
    const cells: Record<string, string> = { sl: String(i + 1), item: l.name.slice(0, 60), rate: num(l.rate), qty: l.qty, amt: num(l.amount) }
    for (const c of COLS) text(doc, cells[c.key], c.x, y, { width: c.w, align: c.right ? 'right' : 'left', size: 8.5 })
    y += 15
  })
  hr(doc, y)
  y += 8
  const top = y
  const row = (label: string, value: string, bold = false) => {
    text(doc, label, 360, y, { bold, width: 110 })
    text(doc, value, 470, y, { bold, width: R - 470, align: 'right' })
    y += bold ? 16 : 13
  }
  if (Number(job.discount) > 0) { row('Sub total', inr(job.chargeTotal)); row('Discount', `− ${inr(job.discount)}`) }
  if (Number(job.roundOff)) row('Round off', `${Number(job.roundOff) > 0 ? '+' : '−'} ${inr(Math.abs(Number(job.roundOff)))}`)
  row('TOTAL', inr(job.grandTotal), true)
  row(job.status === 'DELIVERED' ? 'Paid' : 'Advance', inr(job.paidAmount))
  if (Number(job.returnedAmount) > 0) row('Returned', `− ${inr(job.returnedAmount)}`)
  row('BALANCE', inr(job.dueAmount), true)
  const gst = Number(job.cgstTotal) + Number(job.sgstTotal) + Number(job.igstTotal)
  if (gst > 0) {
    const split = job.taxMode === 'INTRA' ? `CGST ${num(job.cgstTotal)} + SGST ${num(job.sgstTotal)}` : `IGST ${num(job.igstTotal)}`
    text(doc, `GST ${num(job.gstRate, 1)}% included: taxable ${num(job.taxableTotal)}, ${split}`, L, top, { size: 8, width: 300 })
  }
  y += 4
  hr(doc, y)
  text(doc, `Rupees ${job.amountInWords}`, L, y + 8, { bold: true, size: 9 })
  y += 26
  if (job.status === 'CANCELLED') { text(doc, `CANCELLED — ${job.cancelReason ?? ''}`, L, y, { bold: true, color: '#b5121b', size: 11 }); y += 18 }
  if (job.notes) para(doc, `Note: ${job.notes}`, L, y, R - L, { size: 8.5, color: '#444444' })
  // Shop terms (same lines on the printed bill — frontend jobText.ts).
  para(doc, 'Please bring this bill to collect. Thank you!', L, 748, R - L, { size: 9, align: 'center', color: '#444444' })
  para(doc, '* Final stitching after trial only. Alterations are expected.', L, 766, R - L, { size: 8, color: '#666666' })
  para(doc, '* Delivery dates are tentative and may vary depending on workload or unforeseen circumstances.', L, 779, R - L, { size: 8, color: '#666666' })
  return { buffer: await toBuffer(doc), fileName: `${job.docNo.replace(/\//g, '-')}.pdf` }
}
