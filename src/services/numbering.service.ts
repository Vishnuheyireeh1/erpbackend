import { prisma } from '../config/prisma'
import { ApiError } from '../utils/ApiError'
import { todayIST } from '../utils/financialYear'
import { audit } from './audit.service'
import { counterKey, financialYear, formatDocNo, LAYOUTS, layoutKeys, SERIES, type Layout, type SeriesKey } from './numbering/docFormat'
import { formatsFor } from './numbering/docNumber'
import { getSetting } from './settings.service'

// Settings → Document numbers: letters, layout and digits per document type, and the next number
// ("continue from the old bill book"). Numbers only move forward → never reused.

const isSeries = (key: string): key is SeriesKey => SERIES.some((s) => s.key === key)

export async function list() {
  const fy = financialYear(new Date(`${todayIST()}T00:00:00Z`))
  const fmt = await formatsFor()
  const rows = SERIES.map((s) => ({ key: s.key, label: s.label, format: fmt(s.key) }))
  const keys = rows.map((r) => counterKey(r.key, r.format.layout, fy))
  const used = new Map((await prisma.counter.findMany({ where: { key: { in: keys } } })).map((c) => [c.key, c.value]))
  const items = rows.map((r, i) => {
    const last = used.get(keys[i]) ?? 0
    return {
      key: r.key, label: r.label, ...r.format, prefix: r.format.prefix,
      yearly: LAYOUTS[r.format.layout].yearly, financialYear: fy,
      lastNumber: last, nextNumber: last + 1, nextDocNo: formatDocNo(r.format, fy, last + 1),
    }
  })
  return { items, layouts: layoutKeys.map((k) => ({ key: k, ...LAYOUTS[k] })), financialYear: fy }
}

export async function setNext(key: string, nextNumber: number, user: string) {
  const row = (await list()).items.find((s) => s.key === key)
  if (!row) throw ApiError.badRequest(`Unknown series: ${key}`)
  if (!Number.isInteger(nextNumber) || nextNumber < 1 || nextNumber > 9_999_999) throw ApiError.badRequest('Enter a whole number above 0')
  if (nextNumber <= row.lastNumber) {
    throw ApiError.badRequest(`${row.label}: ${row.lastNumber} is already used — the next number must be ${row.lastNumber + 1} or more`)
  }
  const ck = counterKey(row.key, row.layout, row.financialYear)
  await prisma.$transaction(async (tx) => {
    // Re-check inside the transaction so a bill saved meanwhile can't be overtaken.
    const current = await tx.counter.findUnique({ where: { key: ck } })
    if ((current?.value ?? 0) >= nextNumber) throw ApiError.conflict('A document was saved meanwhile — reload and try again')
    await tx.counter.upsert({ where: { key: ck }, create: { key: ck, value: nextNumber - 1 }, update: { value: nextNumber - 1 } })
    await audit(tx, { actor: user, action: 'numbering.set', entity: 'counter', entityId: ck, summary: `${row.label}: next number ${row.nextNumber} → ${nextNumber}` })
  })
  return list()
}

// Change letters / layout / digits of one document type. Already-issued numbers never change.
export async function saveFormat(key: string, input: { prefix?: unknown; layout?: unknown; digits?: unknown }, user: string) {
  if (!isSeries(key)) throw ApiError.badRequest(`Unknown series: ${key}`)
  const prefix = String(input.prefix ?? '').trim().toUpperCase()
  if (!/^[A-Z0-9]{1,8}$/.test(prefix)) throw ApiError.badRequest('Letters: 1–8 letters or digits, no spaces or symbols')
  const layout = String(input.layout) as Layout
  if (!layoutKeys.includes(layout)) throw ApiError.badRequest('Choose a layout')
  const digits = Number(input.digits)
  if (!Number.isInteger(digits) || digits < 1 || digits > 6) throw ApiError.badRequest('Digits: 1 to 6')

  const { items } = await list()
  const clash = items.find((s) => s.key !== key && s.prefix === prefix)
  if (clash) throw ApiError.conflict(`"${prefix}" is already used for ${clash.label} — choose different letters`)
  const before = items.find((s) => s.key === key)!
  const saved = await getSetting('numbering.format')
  const value = { ...saved, [key]: { prefix, layout, digits } }
  await prisma.$transaction(async (tx) => {
    await tx.appSetting.upsert({ where: { key: 'numbering.format' }, create: { key: 'numbering.format', value }, update: { value } })
    await audit(tx, { actor: user, action: 'numbering.format', entity: 'setting', entityId: key, summary: `${before.label}: ${before.nextDocNo} → ${formatDocNo({ prefix, layout, digits }, before.financialYear, 1)} style` })
  })
  return list()
}
