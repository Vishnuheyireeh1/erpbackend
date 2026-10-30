import { z } from 'zod'

// Input rules for each master. Same schema is used for create and edit.

const name = (max: number) =>
  z.string({ error: 'Enter a name' }).trim().min(1, 'Enter a name').max(max, `Keep the name under ${max} characters`)

const isActive = z.boolean().default(true)

export const masterSchemas = {
  // Product types: name + what it works like (Service = no stock, Own-made = production).
  productTypes: z.object({
    name: name(60),
    kind: z.enum(['READY_MADE', 'FINISHED', 'RAW_MATERIAL', 'ACCESSORY', 'SERVICE'], { error: 'Choose how it works' }),
    isActive,
  }),
  categories: z.object({
    name: name(80),
    description: z.string().trim().max(255).nullish().transform((v) => v || null),
    parentId: z.coerce.number().int().positive().nullish().transform((v) => v ?? null),
    isActive,
  }),
  brands: z.object({ name: name(80), isActive }),
  units: z.object({
    name: name(40),
    code: z.string({ error: 'Enter a short code' }).trim().min(1, 'Enter a short code').max(10),
    allowDecimal: z.boolean().default(false),
    isActive,
  }),
  sizes: z.object({
    name: name(30),
    sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
    isActive,
  }),
  colours: z.object({
    name: name(40),
    hexCode: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Colour code must look like #B5121B')
      .nullish()
      .or(z.literal(''))
      .transform((v) => (v ? v.toUpperCase() : null)),
    isActive,
  }),
  taxRates: z.object({
    name: name(40),
    rate: z.coerce
      .number({ error: 'Enter the rate' })
      .min(0, "Rate can't be negative")
      .max(100, 'Rate must be 100 or less'),
    isActive,
  }),
}

export type MasterKey = keyof typeof masterSchemas

export const masterKeys = Object.keys(masterSchemas) as MasterKey[]

// GET /masters/:master?search=&page=&pageSize=&status=&parentId=
export const listQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['all', 'active', 'inactive']).default('all'),
  // categories only: "root" = main categories, a number = subcategories of that parent
  parentId: z.union([z.literal('root'), z.coerce.number().int().positive()]).optional(),
})

export type ListQuery = z.infer<typeof listQuerySchema>
