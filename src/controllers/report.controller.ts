import type { Request, Response } from 'express'
import { exportDirectExpenses, exportJobProfit, exportTailorWork } from '../services/export/tailor.export'
import * as ax from '../services/export/analysis.export'
import * as ex from '../services/export/report.export'
import * as an from '../services/reports/analysis.report'
import { itemProfit, type ItemKind } from '../services/reports/itemProfit.report'
import * as st from '../services/reports/stock.report'
import { dashboard } from '../services/reports/dashboard.service'
import * as gst from '../services/reports/gst.service'
import { salesByDay, topItems } from '../services/reports/sales.report'
import { directExpenses, jobProfit, tailorWork } from '../services/reports/workshop.report'
import { ApiError } from '../utils/ApiError'
import { reportRangeSchema } from '../validators/workshop.validator'

function range(req: Request) {
  const r = reportRangeSchema.safeParse(req.query)
  if (!r.success) throw ApiError.badRequest(r.error.issues[0]?.message ?? 'Invalid dates')
  if (r.data.from && r.data.to && r.data.from > r.data.to) throw ApiError.badRequest('"From" is after "To"')
  return r.data
}
const user = (req: Request) => req.admin!.username

// /api/reports/workshop/*
export const tailorWorkReport = async (req: Request, res: Response) => res.json({ success: true, ...(await tailorWork(range(req))) })
export const tailorWorkExport = (req: Request, res: Response) => exportTailorWork(res, range(req), user(req))
export const jobProfitReport = async (req: Request, res: Response) => res.json({ success: true, ...(await jobProfit(range(req))) })
export const jobProfitExport = (req: Request, res: Response) => exportJobProfit(res, range(req), user(req))
export const directExpensesReport = async (req: Request, res: Response) => res.json({ success: true, ...(await directExpenses(range(req))) })
export const directExpensesExport = (req: Request, res: Response) => exportDirectExpenses(res, range(req), user(req))

// /api/dashboard, /api/reports/sales/*, /api/reports/gst/*
export const getDashboard = async (_req: Request, res: Response) => res.json({ success: true, ...(await dashboard()) })
export const salesByDayReport = async (req: Request, res: Response) => res.json({ success: true, ...(await salesByDay(range(req))) })
export const salesByDayExport = (req: Request, res: Response) => ex.exportSalesByDay(res, range(req), user(req))
export const topItemsReport = async (req: Request, res: Response) => res.json({ success: true, ...(await topItems({ ...range(req), limit: 100 })) })
export const topItemsExport = (req: Request, res: Response) => ex.exportTopItems(res, range(req), user(req))
export const gstSummaryReport = async (req: Request, res: Response) => res.json({ success: true, ...(await gst.gstSummary(range(req))) })
export const gstSummaryExport = (req: Request, res: Response) => ex.exportGstSummary(res, range(req), user(req))
const b2b = (req: Request) => req.query.b2b === 'true' || req.query.b2b === '1'
export const gstSalesReport = async (req: Request, res: Response) => res.json({ success: true, ...(await gst.salesRegister({ ...range(req), b2b: b2b(req) })) })
export const gstSalesExport = (req: Request, res: Response) => ex.exportSalesRegister(res, { ...range(req), b2b: b2b(req) }, user(req))
export const gstPurchaseReport = async (req: Request, res: Response) => res.json({ success: true, ...(await gst.purchaseRegister(range(req))) })
export const gstPurchaseExport = (req: Request, res: Response) => ex.exportPurchaseRegister(res, range(req), user(req))
export const gstHsnReport = async (req: Request, res: Response) => res.json({ success: true, ...(await gst.hsnSummary(range(req))) })
export const gstHsnExport = (req: Request, res: Response) => ex.exportHsn(res, range(req), user(req))

// /api/reports/analysis/* — sales by category / customer, who owes, stock on a date, slow-moving, purchases.
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const num = (v: unknown) => (Number(v) > 0 ? Number(v) : undefined)
const dateQ = (req: Request) => {
  const d = str(req.query.date)
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw ApiError.badRequest('Date must look like 2026-03-31')
  return d
}
export const byCategory = async (req: Request, res: Response) => res.json({ success: true, ...(await an.salesByCategory(range(req))) })
export const byCategoryExport = (req: Request, res: Response) => ax.exportSalesByCategory(res, range(req), user(req))
export const byCustomer = async (req: Request, res: Response) => res.json({ success: true, ...(await an.salesByCustomer(range(req))) })
export const byCustomerExport = (req: Request, res: Response) => ax.exportSalesByCustomer(res, range(req), user(req))
export const owes = async (_req: Request, res: Response) => res.json({ success: true, ...(await st.whoOwes()) })
export const owesExport = (req: Request, res: Response) => ax.exportWhoOwes(res, user(req))
export const stockDate = async (req: Request, res: Response) => res.json({ success: true, ...(await st.stockOnDate({ date: dateQ(req), search: str(req.query.search), page: num(req.query.page), pageSize: num(req.query.pageSize) })) })
export const stockDateExport = (req: Request, res: Response) => ax.exportStockOnDate(res, { date: dateQ(req), search: str(req.query.search) }, user(req))
export const slow = async (req: Request, res: Response) => res.json({ success: true, ...(await st.slowMoving({ days: num(req.query.days), search: str(req.query.search), page: num(req.query.page), pageSize: num(req.query.pageSize) })) })
export const slowExport = (req: Request, res: Response) => ax.exportSlowMoving(res, { days: num(req.query.days), search: str(req.query.search) }, user(req))
export const purchases = async (req: Request, res: Response) => res.json({ success: true, ...(req.query.by === 'item' ? await an.purchasesByItem(range(req)) : await an.purchasesBySupplier(range(req))) })
export const purchasesExport = (req: Request, res: Response) => ax.exportPurchases(res, { ...range(req), by: str(req.query.by) }, user(req))

// /api/reports/analysis/item-profit — profit by garment / product (kind = STITCHING | SALE | BRAND, empty = all).
const itemKind = (req: Request) => {
  const k = str(req.query.kind)
  if (k && !['STITCHING', 'SALE', 'BRAND'].includes(k)) throw ApiError.badRequest('Unknown type')
  return k as ItemKind | undefined
}
export const itemProfitReport = async (req: Request, res: Response) => res.json({ success: true, ...(await itemProfit({ ...range(req), kind: itemKind(req) })) })
export const itemProfitExport = (req: Request, res: Response) => ax.exportItemProfit(res, { ...range(req), kind: itemKind(req) }, user(req))
