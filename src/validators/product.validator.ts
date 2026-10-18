import { z } from 'zod'

export const productTypes = ['RAW_MATERIAL', 'READY_MADE', 'FINISHED', 'ACCESSORY', 'SERVICE'] as const

const optionalId = z.coerce.number().int().positive().nullish().transform((v) => v ?? null)
const optionalText = (max: number) =>
  z.string().trim().max(max).nullish().transform((v) => v || null)
const money = (label: string) =>
  z.coerce.number({ error: `Enter ${label}` }).min(0, `${label} can't be negative`).max(9_999_999)

export const variantSchema = z.object({
  id: z.coerce.number().int().positive().optional(), // present = existing variant
  sizeId: optionalId,
  colourId: optionalId,
  // Empty = let the ERP generate an EAN-13. Otherwise the supplier's barcode.
  barcode: z
    .string()
    .trim()
    .max(30)
    .regex(/^[A-Za-z0-9-]*$/, 'Barcode can only have letters, numbers and dashes')
    .nullish()
    .transform((v) => v || null),
  purchasePrice: money('purchase price'),
  sellingPrice: money('selling price'),
  mrp: money('MRP').nullish().transform((v) => v ?? null),
  minStock: z.coerce.number().min(0, "Minimum stock can't be negative").max(9_999_999).default(0),
  isActive: z.boolean().default(true),
})

export const productSchema = z.object({
  name: z.string({ error: 'Enter the product name' }).trim().min(1, 'Enter the product name').max(150),
  type: z.enum(productTypes, { error: 'Choose a product type' }),
  categoryId: z.coerce.number({ error: 'Choose a category' }).int().positive('Choose a category'),
  brandId: optionalId,
  unitId: z.coerce.number({ error: 'Choose a unit' }).int().positive('Choose a unit'),
  taxRateId: optionalId,
  hsnCode: z
    .string()
    .trim()
    .regex(/^(\d{4}|\d{6}|\d{8})$/, 'HSN code must be 4, 6 or 8 digits')
    .nullish()
    .or(z.literal(''))
    .transform((v) => v || null),
  fabric: optionalText(80),
  description: optionalText(1000),
  isActive: z.boolean().default(true),
  variants: z
    .array(variantSchema, { error: 'Add at least one variant' })
    .min(1, 'Add at least one variant')
    .max(300, 'Too many variants (max 300)'),
})

export const productListSchema = z.object({
  search: z.string().trim().max(100).optional(),
  type: z.enum(productTypes).optional(),
  categoryId: z.coerce.number().int().positive().optional(), // main category includes its subcategories
  brandId: z.coerce.number().int().positive().optional(),
  status: z.enum(['all', 'active', 'inactive']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type ProductInput = z.infer<typeof productSchema>
export type VariantInput = z.infer<typeof variantSchema>
export type ProductListQuery = z.infer<typeof productListSchema>
