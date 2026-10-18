import { z } from 'zod'
import { gstinError, gstStates } from '../utils/gst'

const text = (max: number) => z.string().trim().max(max).default('')

// Shop details printed on bills, labels and GST documents.
export const businessProfileSchema = z
  .object({
    shopName: z.string().trim().min(1, 'Enter the shop name').max(80),
    legalName: text(120), // registered business name if different
    gstRegistered: z.boolean().default(true),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .default('')
      .superRefine((g, ctx) => {
        const error = g ? gstinError(g) : null
        if (error) ctx.addIssue({ code: 'custom', message: error })
      }),
    stateCode: z.string().refine((s) => !!gstStates[s], 'Choose the state'),
    addressLine1: text(120),
    addressLine2: text(120),
    city: text(60),
    pincode: z.string().trim().regex(/^(\d{6})?$/, 'PIN code must be 6 digits').default(''),
    phone: z.string().trim().regex(/^[0-9+\-\s,/]{0,60}$/, 'Phone can have digits, +, -, spaces and commas (landline, mobile)').default(''),
    email: z.string().trim().max(120).refine((e) => !e || /^\S+@\S+\.\S+$/.test(e), 'Enter a valid email').default(''),
    billPrefix: z.string().trim().toUpperCase().regex(/^[A-Z]{1,6}$/, 'Bill prefix: 1–6 letters').default('INV'),
  })
  .refine((p) => !p.gstRegistered || p.gstin, { message: 'Enter the GSTIN (or turn off "GST registered")', path: ['gstin'] })
  .refine((p) => !p.gstin || p.gstin.slice(0, 2) === p.stateCode, {
    message: 'GSTIN state code does not match the selected state',
    path: ['stateCode'],
  })

export type BusinessProfile = z.infer<typeof businessProfileSchema>

// Used until the shop fills the profile (Kerala, GST registered — the GSTIN must be added before billing).
export const defaultBusinessProfile: BusinessProfile = {
  shopName: 'Sairandhri Designer Boutique',
  legalName: '',
  gstRegistered: true,
  gstin: '',
  stateCode: '32',
  addressLine1: '',
  addressLine2: '',
  city: '',
  pincode: '',
  phone: '',
  email: '',
  billPrefix: 'INV',
}
