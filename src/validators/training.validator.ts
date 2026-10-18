import { orderField } from '../utils/order'
import { z } from 'zod'
import { paymentModes } from './purchase.validator'

const optional = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null)
const date = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must look like 2026-10-05`)
const phone = z.string().trim().regex(/^[0-9+\-\s]{0,20}$/, 'Phone can have digits, +, - and spaces').nullish().transform((v) => v || null)
const money = (label: string) => z.coerce.number({ error: `Enter the ${label}` }).min(0, `${label} can't be negative`).max(9_999_999)
const toDate = (v: string) => new Date(`${v}T00:00:00Z`)

export const courseSchema = z.object({
  name: z.string({ error: 'Enter the course name' }).trim().min(1, 'Enter the course name').max(100),
  months: z.coerce.number().int().min(1, 'At least 1 month').max(60).default(3),
  fee: money('fee'),
  description: optional(500),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
})

export const batchSchema = z.object({
  courseId: z.coerce.number({ error: 'Choose the course' }).int().positive('Choose the course'),
  name: z.string({ error: 'Enter the batch name' }).trim().min(1, 'Enter the batch name').max(100),
  timing: optional(60),
  startDate: date('Start date').transform(toDate),
  teacherId: z.coerce.number().int().positive().nullish().transform((v) => v ?? null),
  isActive: z.boolean().default(true),
  notes: optional(500),
})

export const studentSchema = z.object({
  name: z.string({ error: 'Enter the student name' }).trim().min(1, 'Enter the student name').max(120),
  phone,
  guardianPhone: phone,
  address: optional(255),
  notes: optional(500),
})

// Enrol = join a batch with the agreed fee (optional first fee payment at the same time).
export const enrolSchema = z.object({
  batchId: z.coerce.number({ error: 'Choose the batch' }).int().positive('Choose the batch'),
  joinedOn: date('Joining date').optional(),
  fee: money('fee'),
  notes: optional(255),
  firstPayment: z.object({ amount: z.coerce.number().positive().max(9_999_999), mode: z.enum(paymentModes), reference: optional(60) }).nullish(),
})

export const newStudentSchema = studentSchema.extend({ enrol: enrolSchema.nullish() })
export const enrolmentUpdateSchema = z.object({ fee: money('fee'), status: z.enum(['STUDYING', 'COMPLETED', 'DROPPED']), notes: optional(255) })

export const feeReceiptSchema = z.object({
  enrolmentId: z.coerce.number({ error: 'Choose the course' }).int().positive('Choose the course'),
  docDate: date('Date').optional(),
  amount: z.coerce.number({ error: 'Enter the amount' }).positive('Enter the amount').max(9_999_999),
  mode: z.enum(paymentModes, { error: 'Choose how it was paid' }),
  reference: optional(60),
  notes: optional(255),
})

export const trainingListSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.string().trim().max(20).optional(), // students: STUDYING / COMPLETED / DROPPED; receipts: POSTED / CANCELLED
  batchId: z.coerce.number().int().positive().optional(),
  courseId: z.coerce.number().int().positive().optional(),
  from: date('From').optional(),
  to: date('To').optional(),
  order: orderField, // newest first (default) / oldest first
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type CourseInput = z.infer<typeof courseSchema>
export type BatchInput = z.infer<typeof batchSchema>
export type StudentInput = z.infer<typeof studentSchema>
export type NewStudentInput = z.infer<typeof newStudentSchema>
export type EnrolInput = z.infer<typeof enrolSchema>
export type EnrolmentUpdate = z.infer<typeof enrolmentUpdateSchema>
export type FeeReceiptInput = z.infer<typeof feeReceiptSchema>
export type TrainingListQuery = z.infer<typeof trainingListSchema>
