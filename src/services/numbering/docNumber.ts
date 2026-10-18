import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { nextValue } from '../../models/counter.model'
import { getSetting } from '../settings.service'
import { counterKey, financialYear, formatDocNo, SERIES, type DocFormat, type SeriesKey } from './docFormat'

type Db = Prisma.TransactionClient | typeof prisma

// The format of every series: saved choice, else the defaults (sales letters from the old Business profile).
export async function formatsFor(db: Db = prisma) {
  const [saved, profile] = await Promise.all([getSetting('numbering.format', db), getSetting('business.profile', db)])
  return (key: SeriesKey): DocFormat => {
    const base = SERIES.find((s) => s.key === key)!
    return saved[key] ?? { prefix: key === 'SALE' ? profile.billPrefix : base.prefix, layout: 'P/FY/N', digits: 4 }
  }
}

// Gap-free document number for a series, e.g. SDB/2026-27/0101 or JOB-2574 (as set in Settings).
// Call inside the same transaction that saves the document (rollback = number not used).
export async function nextDocNo(tx: Prisma.TransactionClient, series: SeriesKey, date: Date) {
  const f = (await formatsFor(tx))(series)
  const fy = financialYear(date)
  const n = await nextValue(tx, counterKey(series, f.layout, fy))
  return formatDocNo(f, fy, n)
}
