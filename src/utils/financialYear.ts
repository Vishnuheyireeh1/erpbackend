
// Financial year + document numbers live in services/numbering (letters / layout set in Settings).
export { financialYear } from '../services/numbering/docFormat'
export { nextDocNo } from '../services/numbering/docNumber'

// Today's date in India (the shop's calendar), e.g. "2026-10-05" — not UTC,
// otherwise 00:00–05:30 IST would still be "yesterday".
export function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

// "2026-10-05" → midnight UTC Date for @db.Date columns. Flags future dates.
export function toDocDate(input: string | undefined) {
  const today = todayIST()
  const value = input ?? today
  return { date: new Date(`${value}T00:00:00.000Z`), isFuture: value > today }
}

// From / To filter on a @db.Date column (both optional, inclusive). Returns undefined when not filtering.
export function dateRange(from?: string, to?: string) {
  if (!from && !to) return undefined
  return {
    ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
    ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}),
  }
}
