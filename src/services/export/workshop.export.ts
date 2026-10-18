import type { Response } from 'express'
import { filterText, sendExcel, type ExcelColumn } from '../../utils/excel'
import type { TailorListQuery } from '../../validators/workshop.validator'
import * as garmentService from '../workshop/garment.service'
import * as tailorService from '../workshop/tailor.service'

export async function exportTailors(res: Response, q: TailorListQuery, user: string) {
  const { items } = await tailorService.list({ ...q, page: 1, pageSize: Number.MAX_SAFE_INTEGER })
  type Row = (typeof items)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Code', value: (t) => t.code, width: 10 },
    { header: 'Tailor', value: (t) => t.name, width: 26 },
    { header: 'Phone', value: (t) => t.phone, width: 15 },
    { header: 'Does', value: (t) => t.does.join(', '), width: 26 },
    { header: 'Paid', value: (t) => (t.payType === 'PIECE' ? 'Per piece' : 'Salary'), width: 12 },
    { header: 'Jobs (dates)', value: (t) => t.period.jobs, type: 'number' },
    { header: 'Pieces (dates)', value: (t) => t.period.pieces, type: 'number' },
    { header: 'Pay earned (dates)', value: (t) => t.period.earned, type: 'money' },
    { header: 'Balance (shop owes)', value: (t) => t.balance, type: 'money' },
    { header: 'Status', value: (t) => (t.isActive ? 'Active' : 'Inactive'), width: 10 },
  ]
  return sendExcel(res, { fileName: 'tailors', title: 'Tailors', filters: filterText([['Search', q.search], ['Status', q.status], ['From', q.from], ['To', q.to]]), columns, rows: [items], user })
}

export async function exportGarments(res: Response, user: string) {
  const items = await garmentService.list()
  type Row = (typeof items)[number]
  const columns: ExcelColumn<Row>[] = [
    { header: 'Garment', value: (g) => g.name, width: 20 },
    { header: 'Measurements', value: (g) => g.fields.join(', '), width: 70 },
    { header: 'Default charge', value: (g) => g.defaultCharge, type: 'money' },
    { header: 'Default tailor labour', value: (g) => g.defaultLabour, type: 'money' },
    { header: 'Saved measurements', value: (g) => g.measurementCount, type: 'number' },
    { header: 'Status', value: (g) => (g.isActive ? 'Active' : 'Inactive'), width: 10 },
  ]
  return sendExcel(res, { fileName: 'garment-types', title: 'Garment types', columns, rows: [items], user })
}
