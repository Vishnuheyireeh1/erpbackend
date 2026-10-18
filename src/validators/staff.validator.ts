import { orderField } from '../utils/order'
import { z } from 'zod'
import { paymentModes } from './purchase.validator'

const optional = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null)
const date = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must look like 2026-10-05`)

const rate = z.coerce.number().min(0).max(9_999_999)

// Job work: how they are paid for it, opening balance, the work they do — stitching (own pay per garment) and
// other work (Cutting, Lining, Embroidery … with their usual pay per piece).
export const staffWorkSchema = z.object({
  payType: z.enum(['PIECE', 'SALARY']).default('PIECE'),
  speciality: optional(120),
  openingBalance: z.coerce.number().min(-9_999_999).max(9_999_999).default(0),
  stitches: z.boolean().default(false),
  rates: z.array(z.object({ garmentTypeId: z.coerce.number().int().positive(), rate })).max(100).default([]),
  works: z.array(z.object({ categoryId: z.coerce.number().int().positive(), rate })).max(50).default([]),
})

export const staffSchema = z.object({
  name: z.string({ error: 'Enter the name' }).trim().min(1, 'Enter the name').max(120),
  phone: z.string().trim().regex(/^[0-9+\-\s]{0,20}$/, 'Phone can have digits, +, - and spaces').nullish().transform((v) => v || null),
  address: optional(255),
  role: z.string({ error: 'Enter the work they do' }).trim().min(1, 'Enter the work they do').max(60),
  dept: z.enum(['WORKSHOP', 'SHOP']).default('SHOP'),
  salary: z.coerce.number().min(0, "Salary can't be negative").max(9_999_999).default(0),
  joinDate: date('Joining date').nullish().transform((v) => (v ? new Date(`${v}T00:00:00Z`) : null)),
  notes: optional(500),
  isActive: z.boolean().default(true),
  work: staffWorkSchema.nullish().transform((v) => v ?? null), // null = no job work
})

export const staffListSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['all', 'active', 'inactive']).default('active'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})

export const salaryPaymentSchema = z.object({
  staffId: z.coerce.number({ error: 'Choose the staff member' }).int().positive('Choose the staff member'),
  docDate: date('Date').optional(),
  month: z.string({ error: 'Choose the salary month' }).regex(/^\d{4}-\d{2}$/, 'Choose the salary month'),
  amount: z.coerce.number({ error: 'Enter the amount' }).positive('Enter the amount').max(9_999_999),
  mode: z.enum(paymentModes, { error: 'Choose how it was paid' }),
  reference: optional(60),
  notes: optional(255),
})

const money = z.coerce.number().min(0).max(9_999_999).default(0)

// Monthly salary screen → "Pay": salary − advance + bonus − deduction, plus the per-piece work due.
export const payslipSchema = z.object({
  staffId: z.coerce.number({ error: 'Choose the staff member' }).int().positive('Choose the staff member'),
  month: z.string({ error: 'Choose the salary month' }).regex(/^\d{4}-\d{2}$/, 'Choose the salary month'),
  docDate: date('Date').optional(),
  bonus: money,
  deduction: money,
  deductionNote: optional(200),
  piecePaid: money, // per-piece work paid now (usually all that is due)
  mode: z.enum(paymentModes, { error: 'Choose how it was paid' }),
  reference: optional(60),
  notes: optional(255),
})

export const payrollSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, 'Choose the month') })

export const salaryListSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['all', 'POSTED', 'CANCELLED']).default('all'),
  staffId: z.coerce.number().int().positive().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  from: date('From').optional(),
  to: date('To').optional(),
  order: orderField, // newest first (default) / oldest first
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type StaffInput = z.infer<typeof staffSchema>
export type StaffWorkInput = z.infer<typeof staffWorkSchema>
export type StaffListQuery = z.infer<typeof staffListSchema>
export type SalaryPaymentInput = z.infer<typeof salaryPaymentSchema>
export type PayslipInput = z.infer<typeof payslipSchema>
export type SalaryListQuery = z.infer<typeof salaryListSchema>
