import { z } from 'zod'
import { gstinError, gstStates } from '../utils/gst'

const optional = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null)

// GST choices on brand delivery bills (0 = no GST).
export const BRAND_GST_RATES = [0, 5, 12, 18] as const

export const brandSchema = z
  .object({
    name: z.string({ error: 'Enter the brand name' }).trim().min(1, 'Enter the brand name').max(120),
    contactPerson: optional(80),
    phone: z.string().trim().regex(/^[0-9+\-\s]{0,20}$/, 'Phone can have digits, +, - and spaces').nullish().transform((v) => v || null),
    email: optional(120).refine((e) => !e || /^\S+@\S+\.\S+$/.test(e), 'Enter a valid email'),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .nullish()
      .transform((v) => v || null)
      .superRefine((g, ctx) => {
        const error = g ? gstinError(g) : null
        if (error) ctx.addIssue({ code: 'custom', message: error })
      }),
    stateCode: z.string().refine((s) => !!gstStates[s], 'Choose the state').default('32'),
    address: optional(255),
    city: optional(60),
    pincode: z.string().trim().regex(/^(\d{6})?$/, 'PIN code must be 6 digits').nullish().transform((v) => v || null),
    gstRate: z.coerce.number().refine((r) => (BRAND_GST_RATES as readonly number[]).includes(r), 'Choose No GST, 5%, 12% or 18%').default(0),
    openingBalance: z.coerce.number().min(-99_999_999).max(99_999_999).default(0),
    notes: optional(500),
    isActive: z.boolean().default(true),
  })
  // With a GSTIN, the state always comes from its first two digits.
  .transform((s) => (s.gstin ? { ...s, stateCode: s.gstin.slice(0, 2) } : s))

export const brandListSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['all', 'active', 'inactive']).default('active'),
  withDues: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type BrandInput = z.infer<typeof brandSchema>
export type BrandListQuery = z.infer<typeof brandListSchema>
