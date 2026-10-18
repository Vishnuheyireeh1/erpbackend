import PDFDocument from 'pdfkit'
import path from 'node:path'

// PDFKit helpers. Noto Sans "latin" has no ₹ glyph, "latin-ext" does → ₹ is drawn with the second font.
const FONT_DIR = path.dirname(require.resolve('@fontsource/noto-sans/package.json')) + '/files'
const FONTS = {
  regular: `${FONT_DIR}/noto-sans-latin-400-normal.woff`,
  bold: `${FONT_DIR}/noto-sans-latin-700-normal.woff`,
  rupee: `${FONT_DIR}/noto-sans-latin-ext-400-normal.woff`,
  rupeeBold: `${FONT_DIR}/noto-sans-latin-ext-700-normal.woff`,
}

export type Doc = InstanceType<typeof PDFDocument>

export function newDoc(size: 'A4' | 'A5' = 'A4') {
  const doc = new PDFDocument({ size, margin: 36, bufferPages: true })
  for (const [name, file] of Object.entries(FONTS)) doc.registerFont(name, file)
  doc.font('regular')
  return doc
}

type Opts = { size?: number; bold?: boolean; align?: 'left' | 'right' | 'center'; width?: number; color?: string }

// Draws one line of text at (x, y); ₹ anywhere in it is rendered with the rupee font.
export function text(doc: Doc, value: string, x: number, y: number, o: Opts = {}) {
  const size = o.size ?? 9
  const base = o.bold ? 'bold' : 'regular'
  const sym = o.bold ? 'rupeeBold' : 'rupee'
  const parts = value.split(/(₹)/).filter(Boolean).map((p) => ({ p, font: p === '₹' ? sym : base }))
  const widthOf = (p: { p: string; font: string }) => doc.font(p.font).fontSize(size).widthOfString(p.p)
  const total = parts.reduce((s, p) => s + widthOf(p), 0)
  const box = o.width ?? 0
  let cx = o.align === 'right' ? x + box - total : o.align === 'center' ? x + (box - total) / 2 : x
  doc.fillColor(o.color ?? '#111111')
  for (const part of parts) {
    doc.font(part.font).fontSize(size).text(part.p, cx, y, { lineBreak: false })
    cx += widthOf(part)
  }
  doc.font('regular')
}

// Wrapped paragraph (no ₹ inside — used for addresses / notes).
export function para(doc: Doc, value: string, x: number, y: number, width: number, o: Opts = {}) {
  doc.font(o.bold ? 'bold' : 'regular').fontSize(o.size ?? 9).fillColor(o.color ?? '#111111')
  doc.text(value, x, y, { width, align: o.align ?? 'left' })
  return doc.y
}

export function hr(doc: Doc, y: number, x1 = 36, x2?: number, color = '#cccccc') {
  doc.moveTo(x1, y).lineTo(x2 ?? doc.page.width - 36, y).lineWidth(0.6).strokeColor(color).stroke()
}

export const inr = (n: number | string | { toString(): string }) =>
  `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const num = (n: number | string | { toString(): string }, dp = 2) =>
  Number(n).toLocaleString('en-IN', { minimumFractionDigits: dp === 3 ? 0 : dp, maximumFractionDigits: dp })

// Collects the PDF into a Buffer.
export function toBuffer(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.end()
  })
}
