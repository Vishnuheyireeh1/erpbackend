import { z } from 'zod'
import { prisma } from '../config/prisma'
import type { Prisma } from '../generated/prisma/client'
import { ApiError } from '../utils/ApiError'
import { businessProfileSchema, defaultBusinessProfile } from '../validators/business.validator'
import { layoutKeys } from './numbering/docFormat'
import { audit } from './audit.service'

// Every setting with its type and default. Add new settings here.
const settingSchemas = {
  'inventory.allowNegativeStock': z.boolean(),
  'business.profile': businessProfileSchema,
  'billing.apparelGstRule': z.boolean(),
  // Bill printer. direct = plain text straight to the dot-matrix (its own font, no print window — like the old software);
  // browser = Chrome's print window. Size in inches; height 0 = long roll (a few blank lines after the bill).
  'billing.print': z.object({
    paperWidthIn: z.coerce.number().min(2).max(15),
    paperHeightIn: z.coerce.number().min(0).max(30),
    columns: z.coerce.number().int().min(32).max(136),
    mode: z.enum(['browser', 'direct']).default('browser'),
    printer: z.string().trim().max(200).default(''),
    feedLines: z.coerce.number().int().min(0).max(60).default(6),
  }),
  // GST on stitching job bills: on by default for new jobs? (each job can still be ticked / unticked) + rate.
  'jobs.gst': z.object({ defaultOn: z.boolean(), rate: z.coerce.number().min(0).max(28) }),
  // Cash in hand and bank balance on the go-live day — the day book starts from these.
  // Letters / layout / digits per document type (Settings → Document numbers); missing = default.
  'numbering.format': z.record(z.string(), z.object({ prefix: z.string(), layout: z.enum(layoutKeys), digits: z.number().int().min(1).max(6) })),
  'money.opening': z.object({ cash: z.coerce.number().min(-99_999_999).max(99_999_999), bank: z.coerce.number().min(-99_999_999).max(99_999_999) }),
} as const

export type SettingKey = keyof typeof settingSchemas

const defaults: { [K in SettingKey]: z.infer<(typeof settingSchemas)[K]> } = {
  'inventory.allowNegativeStock': false,
  'business.profile': defaultBusinessProfile,
  'billing.apparelGstRule': true,
  'billing.print': { paperWidthIn: 8, paperHeightIn: 6, columns: 72, mode: 'browser', printer: '', feedLines: 6 },
  'jobs.gst': { defaultOn: false, rate: 5 },
  'money.opening': { cash: 0, bank: 0 },
  'numbering.format': {},
}

type Db = Prisma.TransactionClient | typeof prisma

export async function getSetting<K extends SettingKey>(key: K, db: Db = prisma) {
  const row = await db.appSetting.findUnique({ where: { key } })
  const parsed = settingSchemas[key].safeParse(row?.value)
  return (parsed.success ? parsed.data : defaults[key]) as (typeof defaults)[K]
}

export async function getAll() {
  const rows = await prisma.appSetting.findMany()
  const out: Record<string, unknown> = { ...defaults }
  for (const r of rows) {
    const schema = settingSchemas[r.key as SettingKey]
    if (schema?.safeParse(r.value).success) out[r.key] = r.value
  }
  return out
}

// Saves known keys only; every change is written to the audit log.
export async function update(changes: Record<string, unknown>, actor: string) {
  // Validate everything first; store the CLEANED value (e.g. GSTIN upper-cased, defaults filled).
  const entries: [string, unknown][] = []
  for (const [key, raw] of Object.entries(changes)) {
    const schema = settingSchemas[key as SettingKey]
    if (!schema) throw ApiError.badRequest(`Unknown setting: ${key}`)
    const parsed = schema.safeParse(raw)
    if (!parsed.success) throw ApiError.badRequest(parsed.error.issues[0]?.message ?? `Invalid value for ${key}`)
    entries.push([key, parsed.data])
  }
  await prisma.$transaction(async (tx) => {
    for (const [key, value] of entries) {
      const before = await getSetting(key as SettingKey, tx)
      await tx.appSetting.upsert({
        where: { key },
        create: { key, value: value as Prisma.InputJsonValue, updatedBy: actor },
        update: { value: value as Prisma.InputJsonValue, updatedBy: actor },
      })
      await audit(tx, {
        actor,
        action: 'setting.update',
        entity: 'setting',
        entityId: key,
        summary: `${key}: ${JSON.stringify(before)} → ${JSON.stringify(value)}`.slice(0, 255),
        details: { before, after: value } as Prisma.InputJsonValue,
      })
    }
  })
  return getAll()
}
