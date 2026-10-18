import { z } from 'zod'
import { paymentModes } from './purchase.validator'

const optional = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null)
const date = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must look like 2026-10-05`)
const qty = z.coerce.number({ error: 'Enter the quantity' }).positive('Quantity must be more than 0').max(9_999_999)
const line = z.object({ variantId: z.coerce.number().int().positive('Choose the item'), qty })

const cost = z
  .object({
    kind: z.enum(['TAILOR', 'PAID', 'SALARIED']),
    description: z.string({ error: 'Describe the cost' }).trim().min(1, 'Describe the cost').max(120),
    tailorId: z.coerce.number().int().positive().nullish(),
    qty: z.coerce.number().positive().max(9_999_999).nullish(),
    rate: z.coerce.number().min(0).max(9_999_999).nullish(),
    amount: z.coerce.number().min(0).max(99_999_999).nullish(),
    mode: z.enum(paymentModes).nullish(),
    reference: optional(60),
  })
  .superRefine((c, ctx) => {
    if (c.kind === 'TAILOR') {
      if (!c.tailorId) ctx.addIssue({ code: 'custom', message: 'Choose the tailor', path: ['tailorId'] })
      if (!c.qty) ctx.addIssue({ code: 'custom', message: 'Enter the pieces stitched', path: ['qty'] })
      if (c.rate == null) ctx.addIssue({ code: 'custom', message: 'Enter the rate per piece', path: ['rate'] })
    } else if (!c.amount) ctx.addIssue({ code: 'custom', message: `Enter the amount for "${c.description}"`, path: ['amount'] })
    if (c.kind === 'PAID' && !c.mode) ctx.addIssue({ code: 'custom', message: `Choose how "${c.description}" was paid`, path: ['mode'] })
  })

export const productionSchema = z.object({
  docDate: date('Date').optional(),
  title: optional(120),
  notes: optional(500),
  outputs: z.array(line, { error: 'Add the finished pieces' }).min(1, 'Add the finished pieces made').max(200),
  materials: z.array(line).max(300).default([]),
  costs: z.array(cost).max(50).default([]),
})

export const productionListSchema = z.object({
  productId: z.coerce.number().int().positive().optional(), // making entries of one product (product page)
  search: z.string().trim().max(100).optional(),
  status: z.enum(['all', 'POSTED', 'CANCELLED']).default('all'),
  from: date('From').optional(),
  to: date('To').optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type ProductionInput = z.infer<typeof productionSchema>
export type ProductionListQuery = z.infer<typeof productionListSchema>
