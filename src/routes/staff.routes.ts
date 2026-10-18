import { Router } from 'express'
import * as s from '../controllers/staff.controller'
import { validateBody } from '../middlewares/validate.middleware'
import { payslipSchema, salaryPaymentSchema, staffSchema } from '../validators/staff.validator'

// /api/staff, /api/salary-payments
export const staffRoutes = Router()
staffRoutes.get('/export', s.exportStaff)
staffRoutes.get('/options', s.staffOptions)
staffRoutes.get('/', s.listStaff)
staffRoutes.get('/:id', s.getStaff)
staffRoutes.post('/', validateBody(staffSchema), s.createStaff)
staffRoutes.put('/:id', validateBody(staffSchema), s.updateStaff)
staffRoutes.delete('/:id', s.removeStaff)

export const salaryRoutes = Router()
salaryRoutes.get('/export', s.exportSalaries)
salaryRoutes.get('/', s.listSalaries)
salaryRoutes.get('/:id', s.getSalary)
salaryRoutes.post('/', validateBody(salaryPaymentSchema), s.createSalary)
salaryRoutes.post('/:id/cancel', s.cancelSalary)

// /api/payroll — monthly salary sheet and payslips
export const payrollRoutes = Router()
payrollRoutes.get('/export', s.exportPayroll)
payrollRoutes.get('/', s.payrollSheet)
payrollRoutes.post('/payslips', validateBody(payslipSchema), s.payPayslip)
payrollRoutes.get('/payslips/:id', s.getPayslip)
payrollRoutes.get('/payslips/:id/pdf', s.payslipPdf)
payrollRoutes.post('/payslips/:id/cancel', s.cancelPayslip)
