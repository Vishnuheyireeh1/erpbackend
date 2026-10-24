import { orderField } from '../utils/order'
import { z } from 'zod'
import { paymentModes } from './purchase.validator'

const optional = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null)
const date = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must look like 2026-10-05`)
const money = z.coerce.number().min(0, "Amount can't be negative").max(9_999_999)

const tender = z.object({
  mode: z.enum(paymentModes, { error: 'Choose how it was paid' }),
  amount: money.refine((n) => n > 0, 'Enter the amount'),
  reference: z.string().trim().max(60).nullish().transform((v) => v || null),
})

const item = z.object({
  id: z.coerce.number().int().positive().optional(), // existing line when editing
  garmentTypeId: z.coerce.number({ error: 'Choose the garment' }).int().positive('Choose the garment'),
  description: optional(200),
  qty: z.coerce.number().int('Pieces must be a whole number').min(1, 'At least 1 piece').max(500),
  chargeRate: money,
  tailorId: z.coerce.number().int().positive().nullish().transform((v) => v ?? null),
  labourRate: money.default(0),
  measurements: z.record(z.string().trim().min(1).max(40), z.string().trim().max(20)).default({}),
  instructions: optional(1000),
  ownFabric: z.boolean().default(false),
  measuredById: z.coerce.number().int().positive().nullish().transform((v) => v ?? null), // staff who measured (optional)
})

// Extra charge on the customer's bill (embroidery ₹500 …). What the shop spends is a job cost entry.
const cost = z.object({
  kind: z.string({ error: 'Choose the charge type' }).trim().min(1, 'Choose the charge type').max(40),
  description: optional(200),
  charge: money.refine((n) => n > 0, 'Enter the charge'),
})

// Shop item on a job: sold (printed, GST-inclusive rate, paid in full when added) or included in the stitching.
const productLine = z.object({
  variantId: z.coerce.number({ error: 'Choose the item' }).int().positive(),
  qty: z.coerce.number({ error: 'Enter a quantity' }).positive('Quantity must be above 0').max(99_999),
  rate: money.default(0), // GST included; ignored when included
  discountPct: z.coerce.number().min(0).max(100, 'Discount can be at most 100%').default(0),
  included: z.boolean().default(false),
})
const productLines = z.array(productLine).max(100, 'Too many items')

const jobBase = {
  expectedDate: date('Ready-by date'),
  gstApplied: z.boolean().default(false),
  discount: money.default(0),
  notes: optional(500),
  internalNotes: optional(1000),
  bookNo: z.string().trim().max(30).nullish(), // paper order book number (optional; left out on edit = unchanged)
  items: z.array(item).min(1, 'Add at least one garment').max(50, 'Too many garments in one job'),
  costs: z.array(cost).max(30).default([]),
}

export const jobCreateSchema = z
  .object({
    ...jobBase,
    customerId: z.coerce.number({ error: 'Choose the customer' }).int().positive('Choose the customer'),
    docDate: date('Order date').optional(),
    parentJobId: z.coerce.number().int().positive().nullish().transform((v) => v ?? null), // alteration of
    tenders: z.array(tender).max(5).default([]), // advance paid at booking (must cover sold items in full)
    useAdvance: z.boolean().default(false),
    products: productLines.default([]),
  })
  .refine((j) => !j.docDate || j.expectedDate >= j.docDate, { message: 'Ready-by date is before the order date', path: ['expectedDate'] })

export const jobUpdateSchema = z.object(jobBase)

export const jobStatuses = ['PENDING', 'CUTTING', 'STITCHING', 'TRIAL', 'READY', 'DELIVERED', 'CANCELLED'] as const
export const jobStatusSchema = z.object({
  status: z.enum(['PENDING', 'CUTTING', 'STITCHING', 'TRIAL', 'READY'], { error: 'Choose the stage' }),
  note: optional(255),
})

export const jobDeliverSchema = z.object({
  docDate: date('Date').optional(),
  tenders: z.array(tender).max(5).default([]),
  useAdvance: z.boolean().default(false),
  note: optional(255),
})

// Add items to an open job (at booking or when collecting). Sold items are paid in full now.
export const jobAddItemsSchema = z.object({
  lines: productLines.min(1, 'Add at least one item'),
  tenders: z.array(tender).max(5).default([]),
  useAdvance: z.boolean().default(false),
})

export const jobListSchema = z.object({
  search: z.string().trim().max(100).optional(),
  // open = not delivered / cancelled; due = delivery today or earlier and still open
  view: z.enum(['open', 'due', 'overdue', 'ready', 'delivered', 'cancelled', 'all', 'unpaid', 'unassigned']).default('open'),
  status: z.enum(jobStatuses).optional(),
  tailorId: z.coerce.number().int().positive().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  from: date('From').optional(),
  to: date('To').optional(),
  order: orderField, // newest first (default) / oldest first
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

// What the shop spends on a job (any time, even after delivery).
export const jobCostEntrySchema = z
  .object({
    categoryId: z.coerce.number({ error: 'Choose the cost type' }).int().positive('Choose the cost type'),
    date: date('Date').optional(),
    description: optional(200),
    qty: z.coerce.number().positive('Quantity must be above 0').max(99_999).default(1),
    rate: money,
    // WORKER = our per-piece worker did it (owed to them when the job is Ready) · SALARIED = cost only · PAID = paid out now
    paidBy: z.enum(['WORKER', 'SALARIED', 'PAID']),
    mode: z.enum(paymentModes).nullish().transform((v) => v ?? null),
    tailorId: z.coerce.number().int().positive().nullish().transform((v) => v ?? null), // who did the work
  })
  .refine((e) => e.paidBy !== 'PAID' || !!e.mode, { message: 'Choose how it was paid', path: ['mode'] })
  .refine((e) => e.paidBy !== 'WORKER' || !!e.tailorId, { message: 'Choose who did the work', path: ['tailorId'] })

// Who stitches each garment, and their pay per piece — set by the workshop after billing.
// Assign workers: per garment — who stitches it (pay per piece + note), and who did each other work (Cutting, Lining,
// Embroidery …). Work rows without a person are "not needed" and are removed.
const who = z.coerce.number().int().positive().nullish().transform((v) => v ?? null)
export const jobWorkersSchema = z.object({
  items: z.array(z.object({
    id: z.coerce.number().int().positive(),
    tailorId: who,
    labourRate: money,
    labourNote: optional(200),
    works: z.array(z.object({ categoryId: z.coerce.number().int().positive(), tailorId: who, rate: money, note: optional(200) })).max(30).default([]),
  })).min(1).max(100),
})
export type JobWorkersInput = z.infer<typeof jobWorkersSchema>

export type JobCostEntryInput = z.infer<typeof jobCostEntrySchema>
export type JobCreateInput = z.infer<typeof jobCreateSchema>
export type JobUpdateInput = z.infer<typeof jobUpdateSchema>
export type JobItemInput = z.infer<typeof item>
export type JobListQuery = z.infer<typeof jobListSchema>
export type JobDeliverInput = z.infer<typeof jobDeliverSchema>
export type JobProductLine = z.infer<typeof productLine>
export type JobAddItemsInput = z.infer<typeof jobAddItemsSchema>
