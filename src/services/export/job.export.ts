import { byDate } from '../../utils/order'
import type { Response } from 'express'
import { prisma } from '../../config/prisma'
import { filterText, inBatches, sendExcel, type ExcelColumn } from '../../utils/excel'
import type { JobListQuery } from '../../validators/job.validator'
import { jobWhere } from '../jobs/job.query'
import { statusLabels } from '../jobs/job.status'

// Job register with costing: what was charged vs what it actually cost (SRS 8).
export async function exportJobs(res: Response, q: JobListQuery, user: string) {
  const where = await jobWhere(q)
  const fetch = (skip: number, take: number) =>
    prisma.stitchingJob.findMany({
      where, orderBy: byDate(q.order), skip, take,
      include: { items: { select: { description: true, qty: true, labourRate: true, tailor: { select: { name: true } } } }, materials: { select: { qty: true, unitCost: true } }, costEntries: { select: { amount: true } } },
    })
  type Row = Awaited<ReturnType<typeof fetch>>[number]
  const labour = (j: Row) => j.items.reduce((s, i) => s + i.qty * Number(i.labourRate), 0)
  const material = (j: Row) => j.materials.reduce((s, m) => s + Number(m.qty) * Number(m.unitCost), 0)
  const other = (j: Row) => j.costEntries.reduce((s, c) => s + Number(c.amount), 0)
  const columns: ExcelColumn<Row>[] = [
    { header: 'Job no', value: (j) => j.docNo, width: 20 },
    { header: 'SJ number', value: (j) => j.bookNo, width: 10 },
    { header: 'Order date', value: (j) => j.docDate, type: 'date', width: 13 },
    { header: 'Ready by', value: (j) => j.expectedDate, type: 'date', width: 13 },
    { header: 'Customer', value: (j) => j.customerName, width: 24 },
    { header: 'Phone', value: (j) => j.customerPhone, width: 14 },
    { header: 'Garments', value: (j) => j.items.map((i) => `${i.qty} × ${i.description}`).join(', '), width: 34 },
    { header: 'Tailors', value: (j) => [...new Set(j.items.map((i) => i.tailor?.name).filter(Boolean))].join(', '), width: 20 },
    { header: 'Status', value: (j) => statusLabels[j.status], width: 14 },
    { header: 'Total', value: (j) => j.grandTotal, type: 'money' },
    { header: 'GST', value: (j) => Number(j.cgstTotal) + Number(j.sgstTotal) + Number(j.igstTotal), type: 'money' },
    { header: 'Received', value: (j) => j.paidAmount, type: 'money' },
    { header: 'Balance', value: (j) => (j.status === 'CANCELLED' ? null : Math.max(0, Number(j.grandTotal) - Number(j.paidAmount) - Number(j.returnedAmount))), type: 'money' },
    { header: 'Material cost', value: material, type: 'money' },
    { header: 'Labour cost', value: labour, type: 'money' },
    { header: 'Other cost', value: other, type: 'money' },
    { header: 'Profit (before GST)', value: (j) => (j.status === 'CANCELLED' ? null : Number(j.taxableTotal) - material(j) - labour(j) - other(j)), type: 'money' },
  ]
  return sendExcel(res, { fileName: 'stitching-jobs', title: 'Stitching jobs', filters: filterText([['View', q.view], ['Search', q.search], ['From', q.from], ['To', q.to]]), columns, rows: inBatches(fetch), user })
}
