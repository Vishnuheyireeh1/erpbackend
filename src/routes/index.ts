import express, { Router } from 'express'
import * as settingsController from '../controllers/settings.controller'
import { requireAuth } from '../middlewares/auth.middleware'
import { UPLOADS_DIR } from '../services/product/product.image'
import authRoutes from './auth.routes'
import healthRoutes from './health.routes'
import { expenseCategoryRoutes, expenseRoutes, financeRoutes, movementRoutes } from './finance.routes'
import jobRoutes from './job.routes'
import masterRoutes from './master.routes'
import productRoutes from './product.routes'
import { brandBillRoutes, brandOrderRoutes, brandPaymentRoutes, brandReportRoutes, brandRoutes } from './brand.routes'
import { paymentRoutes, purchaseRoutes, returnRoutes, supplierRoutes } from './purchase.routes'
import { customerRoutes, receiptRoutes, salesReturnRoutes, salesRoutes } from './sales.routes'
import { payrollRoutes, salaryRoutes, staffRoutes } from './staff.routes'
import productionRoutes from './production.routes'
import stockRoutes from './stock.routes'
import trainingRoutes from './training.routes'
import systemRoutes from './system.routes'
import { costCategoryRoutes, garmentRoutes, measurementRoutes, tailorPaymentRoutes, tailorRoutes } from './workshop.routes'
import accountsRoutes from './accounts.routes'
import { searchAll, todo } from '../services/search.service'
import * as reports from '../controllers/report.controller'

const router = Router()

// Public
router.use('/health', healthRoutes)
router.use('/auth', authRoutes)

// Everything below needs the admin login.
router.use(requireAuth)
router.use('/masters', masterRoutes)
router.use('/products', productRoutes)
router.use('/stock', stockRoutes)
router.use('/suppliers', supplierRoutes)
router.use('/purchases', purchaseRoutes)
router.use('/supplier-payments', paymentRoutes)
router.use('/purchase-returns', returnRoutes)
router.use('/customers/:id/measurements', measurementRoutes)
router.use('/customers', customerRoutes)
router.use('/tailors', tailorRoutes)
router.use('/brands', brandRoutes)
router.use('/brand-orders', brandOrderRoutes)
router.use('/brand-bills', brandBillRoutes)
router.use('/brand-payments', brandPaymentRoutes)
router.use('/reports/brands', brandReportRoutes)
router.use('/garment-types', garmentRoutes)
router.use('/job-cost-categories', costCategoryRoutes)
router.use('/jobs', jobRoutes)
router.use('/expenses', expenseRoutes)
router.use('/expense-categories', expenseCategoryRoutes)
router.use('/money-movements', movementRoutes)
router.use('/finance', financeRoutes)
router.use('/accounts', accountsRoutes)
// Top-bar search: customers, jobs, bills, products at once.
router.get('/search', async (req, res) => { res.json({ success: true, ...(await searchAll(String(req.query.q ?? '').slice(0, 60))) }) })
router.get('/todo', async (_req, res) => { res.json({ success: true, ...(await todo()) }) })
router.use('/tailor-payments', tailorPaymentRoutes)
router.use('/staff', staffRoutes)
router.use('/production', productionRoutes)
router.use('/training', trainingRoutes)
router.use('/system', systemRoutes)
router.use('/salary-payments', salaryRoutes)
router.use('/payroll', payrollRoutes)
router.get('/dashboard', reports.getDashboard)
router.get('/reports/sales/by-day', reports.salesByDayReport)
router.get('/reports/sales/by-day/export', reports.salesByDayExport)
router.get('/reports/sales/items', reports.topItemsReport)
router.get('/reports/sales/items/export', reports.topItemsExport)
router.get('/reports/gst/summary', reports.gstSummaryReport)
router.get('/reports/gst/summary/export', reports.gstSummaryExport)
router.get('/reports/gst/sales', reports.gstSalesReport)
router.get('/reports/gst/sales/export', reports.gstSalesExport)
router.get('/reports/gst/purchases', reports.gstPurchaseReport)
router.get('/reports/gst/purchases/export', reports.gstPurchaseExport)
router.get('/reports/gst/hsn', reports.gstHsnReport)
router.get('/reports/gst/hsn/export', reports.gstHsnExport)
router.get('/reports/analysis/by-category', reports.byCategory)
router.get('/reports/analysis/by-category/export', reports.byCategoryExport)
router.get('/reports/analysis/by-customer', reports.byCustomer)
router.get('/reports/analysis/by-customer/export', reports.byCustomerExport)
router.get('/reports/analysis/who-owes', reports.owes)
router.get('/reports/analysis/who-owes/export', reports.owesExport)
router.get('/reports/analysis/stock-on-date', reports.stockDate)
router.get('/reports/analysis/stock-on-date/export', reports.stockDateExport)
router.get('/reports/analysis/slow-moving', reports.slow)
router.get('/reports/analysis/slow-moving/export', reports.slowExport)
router.get('/reports/analysis/purchases', reports.purchases)
router.get('/reports/analysis/purchases/export', reports.purchasesExport)
router.get('/reports/workshop/tailor-work', reports.tailorWorkReport)
router.get('/reports/workshop/tailor-work/export', reports.tailorWorkExport)
router.get('/reports/workshop/job-profit', reports.jobProfitReport)
router.get('/reports/workshop/job-profit/export', reports.jobProfitExport)
router.get('/reports/workshop/direct-expenses', reports.directExpensesReport)
router.get('/reports/workshop/direct-expenses/export', reports.directExpensesExport)
router.use('/sales', salesRoutes)
router.use('/receipts', receiptRoutes)
router.use('/sales-returns', salesReturnRoutes)
router.get('/settings', settingsController.getAll)
router.put('/settings', settingsController.update)
router.get('/settings/numbering', settingsController.numbering)
router.put('/settings/numbering', settingsController.setNumbering)
router.put('/settings/numbering/format', settingsController.saveNumberingFormat)

// Uploaded files (product photos) — also login-only.
router.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d', index: false, dotfiles: 'deny' }))

export default router
