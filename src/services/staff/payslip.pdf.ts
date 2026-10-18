import { amountInWords } from '../../utils/amountWords'
import { hr, inr, newDoc, num, para, text, toBuffer } from '../../utils/pdf'
import { getSetting } from '../settings.service'
import type { WorkLine } from './payroll.sheet'
import { getPayslip } from './payroll.service'

const L = 36
const R = 559
const MID = 300
const fmtDate = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
const monthName = (d: Date) => d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })

// A4 salary slip: shop header, staff, earnings | deductions, net paid, per-piece work done this month, signatures.
export async function payslipPdf(id: number) {
  const [p, shop] = await Promise.all([getPayslip(id), getSetting('business.profile')])
  const doc = newDoc('A4')
  para(doc, shop.shopName.toUpperCase(), L, 36, R - L, { size: 16, bold: true, align: 'center' })
  const addr = [shop.addressLine1, shop.addressLine2, [shop.city, shop.pincode].filter(Boolean).join(' - ')].filter(Boolean).join(', ')
  let y = para(doc, [addr, shop.phone && `Ph: ${shop.phone}`].filter(Boolean).join('   ·   ') || ' ', L, doc.y + 2, R - L, { size: 9, align: 'center', color: '#444444' })
  para(doc, `SALARY SLIP — ${monthName(p.month).toUpperCase()}`, L, y + 8, R - L, { size: 12, bold: true, align: 'center' })
  y = doc.y + 6
  hr(doc, y)
  y += 8
  text(doc, `Payslip No: ${p.docNo}`, L, y, { bold: true })
  text(doc, `Paid on: ${fmtDate(p.docDate)}`, MID, y, { width: R - MID, align: 'right' })
  y += 14
  text(doc, `Name: ${p.staff.name} (${p.staff.code})`, L, y, { bold: true })
  text(doc, `Paid by: ${p.mode}${p.reference ? ` · ${p.reference}` : ''}`, MID, y, { width: R - MID, align: 'right' })
  y += 14
  text(doc, `Work: ${p.staff.role}`, L, y)
  if (p.staff.phone) text(doc, `Phone: ${p.staff.phone}`, MID, y, { width: R - MID, align: 'right' })
  y += 20

  // Earnings | Deductions — net = (earnings) − (deductions)
  const before = Number(p.pieceBefore)
  const kept = Math.max(0, Number(p.pieceEarned) + before - Number(p.piecePaid))
  const earnings = ([
    ['Monthly salary', Number(p.salary)],
    ['Bonus / extra', Number(p.bonus)],
    [`Per-piece work this month${p.piecePieces ? ` (${p.piecePieces} pcs stitched)` : ''}`, Number(p.pieceEarned)],
    ['Earlier per-piece balance', Math.max(0, before)],
  ] as [string, number][]).filter(([, v]) => v > 0)
  const deductions = ([
    ['Salary advance already paid', Number(p.advance)],
    [`Deduction${p.deductionNote ? ` — ${p.deductionNote}` : ''}`, Number(p.deduction)],
    ['Per-piece advance taken earlier', Math.max(0, -before)],
    ['Per-piece pay kept for later', kept],
  ] as [string, number][]).filter(([, v]) => v > 0)
  const box = (title: string, rows: [string, number][], x: number, w: number) => {
    let yy = y
    doc.rect(x, yy - 3, w, 16).fill('#f2f2f2')
    text(doc, title, x + 4, yy, { bold: true })
    yy += 18
    for (const [label, v] of rows) {
      para(doc, label, x + 4, yy, w - 90, { size: 9 })
      if (v || label !== 'None') text(doc, inr(v), x + w - 90, yy, { width: 86, align: 'right' })
      yy = Math.max(yy + 14, doc.y + 2)
    }
    return { end: yy, total: rows.reduce((t, [, v]) => t + v, 0) }
  }
  const e = box('Earnings', earnings.length ? earnings : [['Monthly salary', 0]], L, MID - L - 8)
  const d = box('Deductions', deductions.length ? deductions : [['None', 0]], MID, R - MID)
  y = Math.max(e.end, d.end) + 4
  hr(doc, y)
  y += 6
  text(doc, `Total earnings ${inr(e.total)}`, L + 4, y, { bold: true })
  text(doc, `Total deductions ${inr(d.total)}`, MID, y, { bold: true, width: R - MID - 4, align: 'right' })
  y += 22
  doc.rect(L, y - 5, R - L, 24).fill('#f2f2f2')
  text(doc, 'NET PAID', L + 8, y, { bold: true, size: 12 })
  text(doc, inr(p.netPaid), MID, y, { bold: true, size: 12, width: R - MID - 8, align: 'right' })
  y += 26
  text(doc, `Rupees ${amountInWords(Number(p.netPaid))}`, L, y, { bold: true, size: 9 })
  y += 22

  const work = (p.work ?? []) as WorkLine[]
  if (work.length) {
    text(doc, 'Work done this month', L, y, { bold: true })
    y += 16
    for (const w of work) {
      if (y > 720) { doc.addPage(); y = 50 }
      text(doc, `${w.date.slice(8, 10)}/${w.date.slice(5, 7)}  ${w.docNo}`, L, y, { size: 8.5 })
      para(doc, w.detail, 150, y, 330, { size: 8.5 })
      text(doc, num(w.amount), 480, y, { width: R - 480, align: 'right', size: 8.5 })
      y = Math.max(y + 13, doc.y + 2)
    }
    y += 8
  }
  if (p.notes) { para(doc, `Note: ${p.notes}`, L, y, R - L, { size: 8.5, color: '#444444' }); y = doc.y + 8 }
  if (p.status === 'CANCELLED') text(doc, `CANCELLED — ${p.cancelReason ?? ''}`, L, y, { bold: true, color: '#b5121b', size: 11 })
  hr(doc, 760, L, 220)
  hr(doc, 760, 375, R)
  text(doc, 'Staff signature', L, 765, { size: 9, color: '#555555' })
  text(doc, `For ${shop.shopName}`, 375, 765, { size: 9, color: '#555555', width: R - 375, align: 'right' })
  return { buffer: await toBuffer(doc), fileName: `${p.docNo.replace(/\//g, '-')}.pdf` }
}
