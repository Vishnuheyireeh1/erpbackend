// How document numbers look. Each document type (series) has its own letters, layout and digits,
// chosen in Settings → Document numbers. Pure functions — no database here.

// Indian financial year: 1 April → 31 March. 5 Oct 2026 → "2026-27", 10 Feb 2027 → "2026-27".
export function financialYear(date: Date) {
  const year = date.getUTCFullYear()
  const start = date.getUTCMonth() >= 3 ? year : year - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

// P = letters, FY = 2026-27, FYS = 2627 (short year), N = running number.
// Layouts with a year restart at 1 every April; layouts without a year keep counting.
export const LAYOUTS = {
  'P/FY/N': { yearly: true, label: 'Letters / year / number' },
  'P/FYS/N': { yearly: true, label: 'Letters / short year / number' },
  'N/FYS-P': { yearly: true, label: 'Number / short year - letters (old bill book)' },
  'P-FYS-N': { yearly: true, label: 'Letters - short year - number' },
  'P/N': { yearly: false, label: 'Letters / number (no year)' },
  'P-N': { yearly: false, label: 'Letters - number (no year)' },
  PN: { yearly: false, label: 'Letters and number together (no year)' },
} as const
export type Layout = keyof typeof LAYOUTS
export const layoutKeys = Object.keys(LAYOUTS) as [Layout, ...Layout[]]

export type DocFormat = { prefix: string; layout: Layout; digits: number }

// Every numbered document type. key = permanent id (also the counter name); prefix = default letters.
export const SERIES = [
  { key: 'SALE', label: 'Sales bills', prefix: 'INV' }, // default letters come from the old Business profile setting
  { key: 'JOB', label: 'Stitching job bills', prefix: 'JOB' },
  { key: 'BRO', label: 'Brand orders', prefix: 'BRO' },
  { key: 'BD', label: 'Brand delivery bills', prefix: 'BD' },
  { key: 'BRP', label: 'Money from brands', prefix: 'BRP' },
  { key: 'RCP', label: 'Money received', prefix: 'RCP' },
  { key: 'SR', label: 'Sales returns', prefix: 'SR' },
  { key: 'PUR', label: 'Purchase bills', prefix: 'PUR' },
  { key: 'PAY', label: 'Supplier payments', prefix: 'PAY' },
  { key: 'DN', label: 'Purchase returns', prefix: 'DN' },
  { key: 'TP', label: 'Tailor payments', prefix: 'TP' },
  { key: 'PRD', label: 'Production', prefix: 'PRD' },
  { key: 'FEE', label: 'Training fee receipts', prefix: 'FEE' },
  { key: 'EXP', label: 'Expenses', prefix: 'EXP' },
  { key: 'SAL', label: 'Salary paid', prefix: 'SAL' },
  { key: 'PS', label: 'Payslips', prefix: 'PS' },
  { key: 'MOV', label: 'Cash / bank movements', prefix: 'MOV' },
  { key: 'OPN', label: 'Opening stock', prefix: 'OPN' },
  { key: 'ADJ', label: 'Stock adjustments', prefix: 'ADJ' },
  { key: 'JV', label: 'Journal entries (accounts)', prefix: 'JV' },
] as const
export type SeriesKey = (typeof SERIES)[number]['key']

// "2026-27" → "2627"
const shortYear = (fy: string) => `${fy.slice(2, 4)}${fy.slice(5, 7)}`

export function formatDocNo(f: DocFormat, fy: string, n: number) {
  const num = String(n).padStart(f.digits, '0')
  switch (f.layout) {
    case 'P/FYS/N': return `${f.prefix}/${shortYear(fy)}/${num}`
    case 'N/FYS-P': return `${num}/${shortYear(fy)}-${f.prefix}`
    case 'P-FYS-N': return `${f.prefix}-${shortYear(fy)}-${num}`
    case 'P/N': return `${f.prefix}/${num}`
    case 'P-N': return `${f.prefix}-${num}`
    case 'PN': return `${f.prefix}${num}`
    default: return `${f.prefix}/${fy}/${num}`
  }
}

// Which counter a number comes from: per financial year, or one running count for no-year layouts.
export const periodOf = (layout: Layout, fy: string) => (LAYOUTS[layout].yearly ? fy : 'ALL')
export const counterKey = (series: string, layout: Layout, fy: string) => `${series}:${periodOf(layout, fy)}`
