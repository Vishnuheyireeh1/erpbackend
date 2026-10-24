import { z } from 'zod'
import { orderField } from '../utils/order'

const optional = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null)
const date = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must look like 2026-10-05`)
const money = z.coerce.number().min(0, "Amount can't be negative").max(9_999_999)

// Cloth / lining from our stock for one piece: charged to the brand (GST-inclusive rate) or used free.
const materialLine = z.object({
  variantId: z.coerce.number({ error: 'Choose the item' }).int().positive(),
  qty: z.coerce.number({ error: 'Enter a quantity' }).positive('Quantity must be above 0').max(99_999),
  rate: money.default(0),
  discountPct: z.coerce.number().min(0).max(100, 'Discount can be at most 100%').default(0),
  charged: z.boolean().default(true),
})
export const materialLines = z.array(materialLine).max(30, 'Too many items for one piece')

const piece = z.object({
  id: z.coerce.number().int().positive().optional(), // existing piece when editing
  garmentTypeId: z.coerce.number({ error: 'Choose the garment' }).int().positive('Choose the garment'),
  description: optional(200),
  endCustomer: optional(120),
  qty: z.coerce.number().int('Pieces must be a whole number').min(1, 'At least 1 piece').max(500),
  chargeRate: money,
  brandCloth: z.boolean().default(false),
  measurements: z.record(z.string().trim().min(1).max(40), z.string().trim().max(20)).default({}),
  instructions: optional(1000),
  tailorId: z.coerce.number().int().positive().nullish().transform((v) => v ?? null),
  labourRate: money.default(0),
  materials: materialLines.default([]), // new pieces only (later: add / remove on the order page)
})

const orderBase = {
  theirOrderNo: optional(40),
  expectedDate: date('Due date'),
  labelNote: optional(300),
  notes: optional(1000),
  items: z.array(piece).min(1, 'Add at least one piece').max(200, 'Too many pieces in one order'),
}

export const brandOrderCreateSchema = z.object({
  ...orderBase,
  brandId: z.coerce.number({ error: 'Choose the brand' }).int().positive('Choose the brand'),
  docDate: date('Received date').optional(),
})
export const brandOrderUpdateSchema = z.object(orderBase)

export const brandMaterialAddSchema = z.object({ itemId: z.coerce.number().int().positive(), lines: materialLines.min(1, 'Add at least one item') })
export const brandStageSchema = z.object({
  itemIds: z.array(z.coerce.number().int().positive()).min(1, 'Choose the pieces').max(200),
  stage: z.enum(['IN_WORK', 'READY']),
})
export const brandTailorSchema = z.object({ tailorId: z.coerce.number().int().positive().nullish().transform((v) => v ?? null), labourRate: money.default(0) })
// Work / cost on a brand order (embroidery, hand work …).
export const brandCostSchema = z.object({
  categoryId: z.coerce.number({ error: 'Choose the work' }).int().positive('Choose the work'),
  itemId: z.coerce.number().int().positive().nullish().transform((v) => v ?? null),
  date: date('Date').optional(),
  description: optional(200),
  qty: z.coerce.number().positive('Enter the pieces').max(99_999).default(1),
  rate: money.refine((n) => n > 0, 'Enter the rate'),
  paidBy: z.enum(['WORKER', 'SALARIED', 'PAID']),
  mode: z.enum(['CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE']).nullish().transform((v) => v ?? null),
  tailorId: z.coerce.number().int().positive().nullish().transform((v) => v ?? null),
})
export type BrandCostInput = z.infer<typeof brandCostSchema>

export const brandCancelSchema = z.object({ reason: z.string().trim().min(3, 'Write why it is cancelled').max(255) })

export const brandOrderListSchema = z.object({
  search: z.string().trim().max(100).optional(),
  view: z.enum(['open', 'ready', 'late', 'completed', 'cancelled', 'all']).default('open'),
  brandId: z.coerce.number().int().positive().optional(),
  from: date('From').optional(),
  to: date('To').optional(),
  order: orderField,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type BrandOrderCreateInput = z.infer<typeof brandOrderCreateSchema>
export type BrandOrderUpdateInput = z.infer<typeof brandOrderUpdateSchema>
export type BrandPieceInput = z.infer<typeof piece>
export type BrandMaterialInput = z.infer<typeof materialLine>
export type BrandOrderListQuery = z.infer<typeof brandOrderListSchema>
