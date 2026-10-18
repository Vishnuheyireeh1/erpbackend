import type { Request, Response } from 'express'
import type { ZodType } from 'zod'
import * as exporter from '../services/export/staff.export'
import { monthSheet as payrollSheetOf } from '../services/staff/payroll.sheet'
import * as payroll from '../services/staff/payroll.service'
import { payslipPdf as payslipPdfOf } from '../services/staff/payslip.pdf'
import * as salary from '../services/staff/salary.service'
import * as staff from '../services/staff/staff.service'
import { ApiError } from '../utils/ApiError'
import { cancelDocSchema } from '../validators/purchase.validator'
import { payrollSchema, salaryListSchema, staffListSchema, type PayslipInput, type SalaryPaymentInput, type StaffInput } from '../validators/staff.validator'

function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data ?? {})
  if (!r.success) throw ApiError.badRequest(r.error.issues[0]?.message ?? 'Invalid input')
  return r.data
}
function readId(req: Request) {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('Invalid id')
  return id
}
const user = (req: Request) => req.admin!.username
const item = (res: Response, value: unknown, status = 200) => res.status(status).json({ success: true, item: value })

// ---- Staff ----
export const listStaff = async (req: Request, res: Response) => res.json({ success: true, ...(await staff.list(parse(staffListSchema, req.query))) })
export const exportStaff = (req: Request, res: Response) => exporter.exportStaff(res, parse(staffListSchema, req.query), user(req))
export const staffOptions = async (_req: Request, res: Response) => res.json({ success: true, items: await staff.options() })
export const getStaff = async (req: Request, res: Response) => item(res, await staff.getById(readId(req)))
export const createStaff = async (req: Request, res: Response) => item(res, await staff.create(req.body as StaffInput, user(req)), 201)
export const updateStaff = async (req: Request, res: Response) => item(res, await staff.update(readId(req), req.body as StaffInput, user(req)))
export async function removeStaff(req: Request, res: Response) {
  await staff.remove(readId(req), user(req))
  res.json({ success: true })
}

// ---- Salary paid ----
export const listSalaries = async (req: Request, res: Response) => res.json({ success: true, ...(await salary.listPayments(parse(salaryListSchema, req.query))) })
export const exportSalaries = (req: Request, res: Response) => exporter.exportSalaries(res, parse(salaryListSchema, req.query), user(req))
export const getSalary = async (req: Request, res: Response) => item(res, await salary.getPayment(readId(req)))
export const createSalary = async (req: Request, res: Response) => item(res, await salary.createPayment(req.body as SalaryPaymentInput, user(req)), 201)
export const cancelSalary = async (req: Request, res: Response) => item(res, await salary.cancelPayment(readId(req), parse(cancelDocSchema, req.body).reason, user(req)))

// ---- Monthly salary & payslips ----
export const payrollSheet = async (req: Request, res: Response) => res.json({ success: true, ...(await payrollSheetOf(parse(payrollSchema, req.query).month)) })
export const exportPayroll = (req: Request, res: Response) => exporter.exportPayroll(res, parse(payrollSchema, req.query).month, user(req))
export const payPayslip = async (req: Request, res: Response) => item(res, await payroll.pay(req.body as PayslipInput, user(req)), 201)
export const getPayslip = async (req: Request, res: Response) => item(res, await payroll.getPayslip(readId(req)))
export const cancelPayslip = async (req: Request, res: Response) => item(res, await payroll.cancelPayslip(readId(req), parse(cancelDocSchema, req.body).reason, user(req)))
export async function payslipPdf(req: Request, res: Response) {
  const { buffer, fileName } = await payslipPdfOf(readId(req))
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="${fileName}"`)
  res.send(buffer)
}
