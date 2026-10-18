import { orderField } from '../utils/order'
import { z } from 'zod'

const date = (label: string) => z.string({ error: `Enter the ${label}` }).regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must look like 2026-10-05`)
const money = z.coerce.number().min(0, "Amount can't be negative").max(99_999_999)
export const paymentModes = ['CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE'] as const

export const purchaseLineSchema = z.object({
  variantId: z.coerce.number().int().positive(),
  qty: z.coerce.number({ error: 'Enter a quantity' }).positive('Quantity must be above 0').max(9_999_999),
  rate: money,
  discountPct: z.coerce.number().min(0).max(100, 'Discount can be at most 100%').default(0),
  gstRate: z.coerce.number().min(0).max(40, 'GST rate looks wrong').default(0),
})

export const purchaseSchema = z.object({
  supplierId: z.coerce.number({ error: 'Choose a supplier' }).int().positive('Choose a supplier'),
  supplierInvoiceNo: z.string({ error: "Enter the supplier's bill number" }).trim().min(1, "Enter the supplier's bill number").max(40),
  supplierInvoiceDate: date('bill date'),
  docDate: date('received date').optional(),
  otherCharges: money.default(0),
  // Cash / bill discount before GST: a % of the items (preferred) or a ₹ amount.
  billDiscountPct: z.coerce.number().min(0).max(100, 'Discount can be at most 100%').default(0),
  billDiscount: money.default(0),
  chargesGstRate: z.coerce.number().min(0).max(28).default(0), // GST the supplier added on packing / forwarding
  freightSeparate: money.default(0), // paid to the transporter ("To pay") — added to item cost only
  freightNote: z.string().trim().max(120).nullish().transform((v) => v || null),
  freightMode: z.enum(paymentModes).nullish().transform((v) => v ?? null), // transporter paid now (null = still to pay)
  notes: z.string().trim().max(500).nullish().transform((v) => v || null),
  lines: z.array(purchaseLineSchema).min(1, 'Add at least one item').max(1000, 'Too many lines in one bill'),
  // Optional "paid now" — creates a payment allocated to this bill in the same step.
  payNow: z
    .object({ amount: money.refine((n) => n > 0, 'Enter the amount paid'), mode: z.enum(paymentModes), reference: z.string().trim().max(60).nullish() })
    .nullish(),
})

export const paymentSchema = z.object({
  supplierId: z.coerce.number().int().positive('Choose a supplier'),
  docDate: date('payment date').optional(),
  amount: money.refine((n) => n > 0, 'Enter the amount'),
  mode: z.enum(paymentModes, { error: 'Choose how it was paid' }),
  reference: z.string().trim().max(60).nullish().transform((v) => v || null),
  notes: z.string().trim().max(255).nullish().transform((v) => v || null),
  // Bills this payment settles. Empty → oldest unpaid bills first. Anything left over = advance.
  allocations: z
    .array(z.object({ invoiceId: z.coerce.number().int().positive(), amount: money.refine((n) => n > 0, 'Amount must be above 0') }))
    .max(200)
    .optional(),
})

export const purchaseReturnSchema = z.object({
  invoiceId: z.coerce.number().int().positive(),
  docDate: date('return date').optional(),
  reason: z.string({ error: 'Enter the reason' }).trim().min(3, 'Enter the reason').max(255),
  lines: z
    .array(z.object({ purchaseLineId: z.coerce.number().int().positive(), qty: z.coerce.number().positive('Quantity must be above 0') }))
    .min(1, 'Choose at least one item to return'),
})

export const docListSchema = z.object({
  search: z.string().trim().max(60).optional(),
  supplierId: z.coerce.number().int().positive().optional(),
  status: z.enum(['all', 'POSTED', 'CANCELLED', 'unpaid']).default('all'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'From date must look like 2026-10-05').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'To date must look like 2026-10-05').optional(),
  order: orderField, // newest first (default) / oldest first
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const cancelDocSchema = z.object({
  reason: z.string({ error: 'Enter why it is cancelled' }).trim().min(3, 'Enter why it is cancelled').max(255),
})

export type PurchaseInput = z.infer<typeof purchaseSchema>
export type PaymentInput = z.infer<typeof paymentSchema>
export type PurchaseReturnInput = z.infer<typeof purchaseReturnSchema>
// Freight paid to the transporter later (purchase bill → "Pay freight").
export const freightPaidSchema = z.object({
  mode: z.enum(paymentModes, { error: 'Choose how it was paid' }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must look like 2026-10-05').optional(),
})
export type FreightPaidInput = z.infer<typeof freightPaidSchema>

export type DocListQuery = z.infer<typeof docListSchema>
