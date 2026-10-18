import { orderField } from '../utils/order'
import { z } from 'zod'

export const adjustmentReasons = ['DAMAGED', 'LOST', 'FOUND', 'COUNT_CORRECTION', 'SAMPLE', 'OTHER'] as const

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must look like 2026-10-05')
  .optional()

const qty = z.coerce
  .number({ error: 'Enter a quantity' })
  .refine((n) => Number.isFinite(n) && n !== 0, 'Quantity can\'t be zero')
  .refine((n) => Math.abs(n) <= 9_999_999, 'Quantity is too large')

const cost = z.coerce.number().min(0, "Cost can't be negative").max(9_999_999).optional()

const line = z.object({
  variantId: z.coerce.number().int().positive(),
  qty,
  unitCost: cost, // used for stock coming IN; ignored for stock going out (average cost is used)
})

// Opening stock: quantities must be positive.
export const openingSchema = z.object({
  docDate: date,
  note: z.string().trim().max(500).nullish().transform((v) => v || null),
  lines: z
    .array(line.refine((l) => l.qty > 0, 'Opening quantity must be more than zero'))
    .min(1, 'Add at least one item')
    .max(5000, 'Too many lines — use the Excel import'),
})

// Adjustment: + adds stock (needs a cost), − removes stock (at average cost).
export const adjustmentSchema = z.object({
  docDate: date,
  reason: z.enum(adjustmentReasons, { error: 'Choose a reason' }),
  note: z.string().trim().max(500).nullish().transform((v) => v || null),
  lines: z.array(line).min(1, 'Add at least one item').max(5000),
})

export const cancelSchema = z.object({
  reason: z.string({ error: 'Enter why it is cancelled' }).trim().min(3, 'Enter why it is cancelled').max(255),
})

export const stockListSchema = z.object({
  search: z.string().trim().max(100).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  status: z.enum(['all', 'in', 'low', 'out', 'available']).default('all'), // available = any stock above 0 (item picker)
  // Label printing: fetch exact items ("12,15,18") or every size / colour of one product.
  ids: z
    .string()
    .regex(/^\d+(,\d+)*$/, 'ids must look like 1,2,3')
    .transform((s) => s.split(',').map(Number))
    .refine((a) => a.length <= 500, 'Up to 500 ids at a time')
    .optional(),
  productId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
})

export const documentListSchema = z.object({
  kind: z.enum(['OPENING', 'ADJUSTMENT']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'From date must look like 2026-10-05').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'To date must look like 2026-10-05').optional(),
  order: orderField, // newest first (default) / oldest first
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type OpeningInput = z.infer<typeof openingSchema>
export type AdjustmentInput = z.infer<typeof adjustmentSchema>
export type StockListQuery = z.infer<typeof stockListSchema>
export type DocumentListQuery = z.infer<typeof documentListSchema>
