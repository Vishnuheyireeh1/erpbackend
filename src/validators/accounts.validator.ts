import { orderField } from '../utils/order'
import { z } from 'zod'

const date = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must look like 2026-10-05`)
const money = z.coerce.number().min(0, "Amount can't be negative").max(99_999_999)

export const accountKinds = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'DIRECT_EXPENSE', 'INDIRECT_EXPENSE'] as const

export const ledgerAccountSchema = z.object({
  name: z.string({ error: 'Enter the account name' }).trim().min(2, 'Enter the account name').max(80),
  kind: z.enum(accountKinds, { error: 'Choose the account group' }),
  notes: z.string().trim().max(255).nullish().transform((v) => v || null),
  isActive: z.boolean().default(true),
})

const journalLine = z.object({
  accountCode: z.string({ error: 'Choose the account' }).trim().min(1, 'Choose the account').max(20),
  debit: money.default(0),
  credit: money.default(0),
  note: z.string().trim().max(120).nullish().transform((v) => v || null),
})

export const journalSchema = z
  .object({
    docDate: date('Date').optional(),
    narration: z.string({ error: 'Write what this entry is for' }).trim().min(3, 'Write what this entry is for').max(255),
    lines: z.array(journalLine).min(2, 'Add at least two lines (one debit, one credit)').max(40),
  })
  .superRefine((j, ctx) => {
    j.lines.forEach((l, i) => {
      if ((l.debit > 0) === (l.credit > 0)) ctx.addIssue({ code: 'custom', path: ['lines', i], message: `Line ${i + 1}: enter either a debit or a credit amount` })
    })
    const dr = Math.round(j.lines.reduce((s, l) => s + l.debit, 0) * 100)
    const cr = Math.round(j.lines.reduce((s, l) => s + l.credit, 0) * 100)
    if (dr !== cr) ctx.addIssue({ code: 'custom', path: ['lines'], message: `Debit ₹${dr / 100} and credit ₹${cr / 100} must be equal` })
  })

// Reports: as on a date / for a period. Ledger also takes the account (and a customer / supplier / tailor).
export const periodSchema = z.object({ from: date('From').optional(), to: date('To').optional() })
export const ledgerSchema = periodSchema.extend({ party: z.string().regex(/^[CSTB]\d+$/).optional() }) // customer / supplier / tailor / brand
export const salesTypeSchema = periodSchema.extend({ by: z.enum(['day', 'month']).default('day') })
export const journalListSchema = periodSchema.extend({
  status: z.enum(['all', 'POSTED', 'CANCELLED']).default('all'),
  order: orderField, // newest first (default) / oldest first
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type LedgerAccountInput = z.infer<typeof ledgerAccountSchema>
export type JournalInput = z.infer<typeof journalSchema>
export type Period = z.infer<typeof periodSchema>
export type LedgerQuery = z.infer<typeof ledgerSchema>
export type JournalListQuery = z.infer<typeof journalListSchema>
