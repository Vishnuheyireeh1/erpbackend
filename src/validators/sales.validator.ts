import { z } from 'zod'
import { gstinError, gstStates } from '../utils/gst'
import { paymentModes } from './purchase.validator'

const optional = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null)
const date = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must look like 2026-10-05`)
const money = z.coerce.number().min(0, "Amount can't be negative").max(99_999_999)

export const customerSchema = z
  .object({
    name: z.string({ error: 'Enter the customer name' }).trim().min(1, 'Enter the customer name').max(120),
    phone: z.string().trim().regex(/^[0-9+\-\s]{0,20}$/, 'Phone can have digits, +, - and spaces').nullish().transform((v) => v || null),
    email: optional(120).refine((e) => !e || /^\S+@\S+\.\S+$/.test(e), 'Enter a valid email'),
    gstin: z.string().trim().toUpperCase().nullish().transform((v) => v || null).superRefine((g, ctx) => {
      const error = g ? gstinError(g) : null
      if (error) ctx.addIssue({ code: 'custom', message: error })
    }),
    stateCode: z.string().refine((s) => !!gstStates[s], 'Choose the state').default('32'),
    address: optional(255),
    city: optional(60),
    pincode: z.string().trim().regex(/^(\d{6})?$/, 'PIN code must be 6 digits').nullish().transform((v) => v || null),
    openingBalance: z.coerce.number().min(-99_999_999).max(99_999_999).default(0),
    notes: optional(500),
    isActive: z.boolean().default(true),
  })
  .transform((c) => (c.gstin ? { ...c, stateCode: c.gstin.slice(0, 2) } : c))

export const customerListSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['all', 'active', 'inactive']).default('active'),
  withDues: z.coerce.boolean().optional(),
  kind: z.enum(['stitching', 'shop']).optional(), // stitching = has stitching jobs · shop = only bought items
  sort: z.enum(['name', 'recent']).default('name'), // recent = newest added / edited first (billing customer picker)
  match: z.enum(['any', 'start']).default('any'), // start = name / phone begins with the search (billing customer picker)
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const tender = z.object({
  mode: z.enum(paymentModes, { error: 'Choose how it was paid' }),
  amount: money.refine((n) => n > 0, 'Enter the amount'),
  reference: z.string().trim().max(60).nullish().transform((v) => v || null),
})

export const saleSchema = z.object({
  customerId: z.coerce.number().int().positive().nullish().transform((v) => v ?? null),
  walkInName: optional(120), // printed for walk-in customers
  walkInPhone: optional(20),
  docDate: date('Bill date').optional(),
  bookNo: optional(30), // number from the paper bill book (optional)
  billDiscount: money.default(0),
  notes: optional(500),
  lines: z
    .array(z.object({
      variantId: z.coerce.number().int().positive(),
      qty: z.coerce.number({ error: 'Enter a quantity' }).positive('Quantity must be above 0').max(9_999_999),
      rate: money, // GST included
      discountPct: z.coerce.number().min(0).max(100, 'Discount can be at most 100%').default(0),
    }))
    .min(1, 'Add at least one item')
    .max(500, 'Too many lines in one bill'),
  // Money handed over now (cash / UPI / card, can be split). Less than the total = balance due.
  tenders: z.array(tender).max(5).default([]),
  // Use the customer's advance / return credit first (customers only).
  useAdvance: z.boolean().default(false),
})

export const receiptSchema = z.object({
  customerId: z.coerce.number({ error: 'Choose a customer' }).int().positive('Choose a customer'),
  docDate: date('Date').optional(),
  tenders: z.array(tender).min(1, 'Enter the amount received').max(5),
  notes: optional(255),
  // Against a sales bill (invoiceId) or a stitching job (jobId). Empty → oldest open first.
  allocations: z
    .array(z.object({ invoiceId: z.coerce.number().int().positive().optional(), jobId: z.coerce.number().int().positive().optional(), amount: money.refine((n) => n > 0) }))
    .max(200)
    .refine((a) => a.every((x) => !!x.invoiceId !== !!x.jobId), 'Each amount must be against one bill or one job')
    .optional(),
})

// Against a counter bill (invoiceId + salesLineId) or items sold on a stitching job (jobId + jobMaterialId).
// Add / correct the paper book number later (bills and jobs).
export const bookNoSchema = z.object({ bookNo: optional(30) })

export const salesReturnSchema = z.object({
  invoiceId: z.coerce.number().int().positive().optional(),
  jobId: z.coerce.number().int().positive().optional(),
  docDate: date('Return date').optional(),
  reason: z.string({ error: 'Enter the reason' }).trim().min(3, 'Enter the reason').max(255),
  refundMode: z.enum(paymentModes).nullish().transform((v) => v ?? null), // null = keep as credit
  lines: z
    .array(z.object({ salesLineId: z.coerce.number().int().positive().optional(), jobMaterialId: z.coerce.number().int().positive().optional(), qty: z.coerce.number().positive('Quantity must be above 0') }))
    .min(1, 'Choose at least one item'),
}).refine((r) => !!r.invoiceId !== !!r.jobId, 'Choose the bill or the job')
  .refine((r) => r.lines.every((l) => (r.invoiceId ? !!l.salesLineId && !l.jobMaterialId : !!l.jobMaterialId && !l.salesLineId)), 'A returned item does not belong to this bill')

export type CustomerInput = z.infer<typeof customerSchema>
export type CustomerListQuery = z.infer<typeof customerListSchema>
export type SaleInput = z.infer<typeof saleSchema>
export type ReceiptInput = z.infer<typeof receiptSchema>
export type SalesReturnInput = z.infer<typeof salesReturnSchema>
export type Tender = z.infer<typeof tender>
