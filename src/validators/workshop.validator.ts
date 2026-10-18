import { z } from 'zod'
import { paymentModes } from './purchase.validator'

const optional = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null)
const money = z.coerce.number().min(0, "Amount can't be negative").max(9_999_999)
const date = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must look like 2026-10-05`)

export const tailorListSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['all', 'active', 'inactive']).default('active'),
  // Who does this work: 'STITCHING' or a work type id (Cutting, Embroidery …)
  work: z.string().regex(/^(STITCHING|\d+)$/).optional(),
  // Jobs / pieces / pay earned counted between these dates (job Ready date)
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const fieldLabel = z.string().trim().min(1, 'A measurement name is empty').max(40, 'Measurement names can be at most 40 letters')

export const garmentSchema = z.object({
  name: z.string({ error: 'Enter the garment name' }).trim().min(1, 'Enter the garment name').max(60),
  fields: z
    .array(fieldLabel)
    .max(40, 'At most 40 measurements per garment')
    .refine((f) => new Set(f.map((x) => x.toLowerCase())).size === f.length, 'The same measurement is listed twice')
    .default([]),
  defaultCharge: money.default(0),
  defaultLabour: money.default(0),
  // Usual job costs per piece (e.g. Cutting master ₹140) — added automatically when a job is booked.
  costDefaults: z.array(z.object({ categoryId: z.coerce.number().int().positive(), rate: money })).max(30).default([]),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
})

export const measurementSchema = z
  .object({
    garmentTypeId: z.coerce.number({ error: 'Choose the garment' }).int().positive('Choose the garment'),
    takenOn: date('Date').optional(),
    // { "Bust": "34", "Length": "38.5" } — empty values are dropped.
    values: z.record(fieldLabel, z.string().trim().max(20, 'A measurement can be at most 20 characters')).default({}),
    notes: optional(500),
  })
  .transform((m) => ({ ...m, values: Object.fromEntries(Object.entries(m.values).filter(([, v]) => v !== '')) }))
  .refine((m) => Object.keys(m.values).length > 0 || !!m.notes, 'Enter at least one measurement or a note')
  .refine((m) => Object.keys(m.values).length <= 60, 'Too many measurements')

export const costCategorySchema = z.object({
  name: z.string({ error: 'Enter the name' }).trim().min(1, 'Enter the name').max(60),
  defaultPaidBy: z.enum(['SALARIED', 'PAID']).default('PAID'),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
})
export type CostCategoryInput = z.infer<typeof costCategorySchema>

export type TailorListQuery = z.infer<typeof tailorListSchema>
export type GarmentInput = z.infer<typeof garmentSchema>
export type MeasurementInput = z.infer<typeof measurementSchema>

export const tailorPaymentSchema = z.object({
  tailorId: z.coerce.number({ error: 'Choose the tailor' }).int().positive('Choose the tailor'),
  docDate: date('Date').optional(),
  amount: money.refine((n) => n > 0, 'Enter the amount paid'),
  mode: z.enum(paymentModes, { error: 'Choose how it was paid' }),
  reference: optional(60),
  notes: optional(255),
})
export type TailorPaymentInput = z.infer<typeof tailorPaymentSchema>

// Reports: date range (defaults to this month in the service).
export const reportRangeSchema = z.object({ from: date('From').optional(), to: date('To').optional() })
