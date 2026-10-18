import { orderField } from '../utils/order'
import { z } from 'zod'
import { paymentModes } from './purchase.validator'

const optional = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null)
const date = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must look like 2026-10-05`)
const amount = z.coerce.number({ error: 'Enter the amount' }).positive('Enter the amount').max(99_999_999)

export const expenseCategorySchema = z.object({
  name: z.string({ error: 'Enter the name' }).trim().min(1, 'Enter the name').max(60),
  kind: z.enum(['INDIRECT', 'DIRECT', 'ASSET']).default('INDIRECT'), // ASSET = lasts years (AC, machine) → balance sheet
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
})

export const expenseSchema = z.object({
  docDate: date('Date').optional(),
  categoryId: z.coerce.number({ error: 'Choose the expense type' }).int().positive('Choose the expense type'),
  amount,
  mode: z.enum(paymentModes, { error: 'Choose how it was paid' }),
  paidTo: optional(120),
  reference: optional(60),
  notes: optional(255),
})

export const moneyMoveKinds = ['DEPOSIT', 'WITHDRAW', 'OWNER_IN', 'OWNER_OUT', 'OTHER_INCOME'] as const
export const moneyMoveSchema = z
  .object({
    docDate: date('Date').optional(),
    kind: z.enum(moneyMoveKinds, { error: 'Choose what happened' }),
    amount,
    mode: z.enum(paymentModes).default('CASH'),
    reference: optional(60),
    notes: optional(255),
  })
  .refine((m) => !['DEPOSIT', 'WITHDRAW'].includes(m.kind) || m.mode !== 'CASH', { message: 'Choose the bank side (bank transfer / UPI …)', path: ['mode'] })

export const financeListSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['all', 'POSTED', 'CANCELLED']).default('all'),
  categoryId: z.coerce.number().int().positive().optional(),
  kind: z.enum(moneyMoveKinds).optional(),
  expenseKind: z.enum(['DIRECT', 'INDIRECT', 'ASSET']).optional(), // Expenses page: direct (stitching / making) or indirect (shop running)
  from: date('From').optional(),
  to: date('To').optional(),
  order: orderField, // newest first (default) / oldest first
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const rangeSchema = z.object({ from: date('From').optional(), to: date('To').optional(), order: orderField })
export const tallySchema = z.object({ date: date('Date').optional(), counted: z.coerce.number().min(0).max(99_999_999), note: optional(255) })

export type ExpenseCategoryInput = z.infer<typeof expenseCategorySchema>
export type ExpenseInput = z.infer<typeof expenseSchema>
export type MoneyMoveInput = z.infer<typeof moneyMoveSchema>
export type FinanceListQuery = z.infer<typeof financeListSchema>
export type TallyInput = z.infer<typeof tallySchema>

// Expenses page — every cost in one list (typed + salary + worker pay + job costs …).
export const costListSchema = z.object({
  order: orderField,
  from: date('From').optional(),
  to: date('To').optional(),
  kind: z.enum(['DIRECT', 'INDIRECT', 'ASSET']).optional(),
  search: z.string().trim().max(100).optional(),
})
