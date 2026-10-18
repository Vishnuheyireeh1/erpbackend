import { z } from 'zod'
import { BRAND_GST_RATES } from './brand.validator'
import { paymentModes } from './purchase.validator'

const date = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must look like 2026-10-05`)
const optional = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null)

// Deliver pieces → one bill. GST % chosen on the bill (0 = no GST).
export const brandDeliverSchema = z.object({
  itemIds: z.array(z.coerce.number().int().positive()).min(1, 'Tick the pieces to deliver').max(200),
  gstRate: z.coerce.number().refine((r) => (BRAND_GST_RATES as readonly number[]).includes(r), 'Choose No GST, 5%, 12% or 18%'),
  docDate: date('Bill date').optional(),
  notes: optional(500),
})

export const brandPaymentSchema = z.object({
  brandId: z.coerce.number({ error: 'Choose the brand' }).int().positive('Choose the brand'),
  docDate: date('Date').optional(),
  amount: z.coerce.number({ error: 'Enter the amount' }).positive('Enter the amount').max(9_999_999),
  mode: z.enum(paymentModes, { error: 'Choose how it was paid' }),
  reference: optional(60),
  notes: optional(255),
})

export const brandClothSchema = z.object({
  date: date('Date').optional(),
  kind: z.enum(['RECEIVED', 'USED', 'RETURNED'], { error: 'Choose received, used or given back' }),
  description: z.string({ error: 'Enter what cloth it is' }).trim().min(1, 'Enter what cloth it is').max(120),
  qty: z.coerce.number({ error: 'Enter the quantity' }).positive('Enter the quantity').max(99_999),
  unit: z.string().trim().min(1).max(10).default('m'),
  notes: optional(255),
})

export const brandDocCancelSchema = z.object({ reason: z.string().trim().min(3, 'Write why it is cancelled').max(255) })

// Reports and bill / payment lists: brand + date range.
export const brandReportSchema = z.object({
  brandId: z.coerce.number().int().positive().optional(),
  from: date('From').optional(),
  to: date('To').optional(),
})

export type BrandDeliverInput = z.infer<typeof brandDeliverSchema>
export type BrandPaymentInput = z.infer<typeof brandPaymentSchema>
export type BrandClothInput = z.infer<typeof brandClothSchema>
export type BrandReportQuery = z.infer<typeof brandReportSchema>
