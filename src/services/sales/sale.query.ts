import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { amountInWords } from '../../utils/amountWords'
import { ApiError } from '../../utils/ApiError'

const r2 = (n: number) => Math.round(n * 100) / 100

export function dueOf(b: { grandTotal: unknown; paidAmount: unknown; returnedAmount: unknown }) {
  return Math.max(0, r2(Number(b.grandTotal) - Number(b.paidAmount) - Number(b.returnedAmount)))
}

async function unpaidIds(customerId?: number) {
  const rows = customerId
    ? await prisma.$queryRaw<{ id: number }[]>`SELECT id FROM sales_invoices WHERE status = 'POSTED' AND customer_id = ${customerId} AND grand_total - paid_amount - returned_amount > 0.004`
    : await prisma.$queryRaw<{ id: number }[]>`SELECT id FROM sales_invoices WHERE status = 'POSTED' AND grand_total - paid_amount - returned_amount > 0.004`
  return rows.map((r) => r.id)
}

export async function getSale(id: number) {
  const bill = await prisma.salesInvoice.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, code: true, name: true, phone: true, gstin: true, address: true, city: true } },
      lines: { orderBy: { id: 'asc' }, include: { variant: { select: { id: true, sku: true, barcode: true, product: { select: { unit: { select: { code: true } } } } } } } },
      allocations: {
        where: { receipt: { status: 'POSTED' } },
        include: { receipt: { select: { id: true, docNo: true, docDate: true, tenders: true } } },
      },
      returns: { orderBy: { id: 'asc' }, select: { id: true, docNo: true, docDate: true, grandTotal: true, refundAmount: true, status: true } },
      credits: { include: { return: { select: { id: true, docNo: true } } } },
    },
  })
  if (!bill) throw ApiError.notFound('Sales bill not found')
  // Profit on the value WITHOUT GST (GST is not the shop's income).
  const profit = r2(Number(bill.taxableTotal) - Number(bill.costTotal))
  return { ...bill, dueAmount: bill.status === 'POSTED' ? dueOf(bill) : 0, amountInWords: amountInWords(Number(bill.grandTotal)), profit }
}

// A customer's open bills AND stitching jobs (for "receive money"), oldest first.
export async function unpaidDocs(customerId: number) {
  const [bills, jobs] = await Promise.all([
    prisma.salesInvoice.findMany({
      where: { id: { in: await unpaidIds(customerId) } },
      select: { id: true, docNo: true, docDate: true, grandTotal: true, paidAmount: true, returnedAmount: true },
    }),
    prisma.$queryRaw<{ id: number; doc_no: string; doc_date: Date; grand_total: Prisma.Decimal; due: Prisma.Decimal }[]>`
      SELECT id, doc_no, doc_date, grand_total, grand_total - paid_amount - returned_amount AS due FROM stitching_jobs
      WHERE customer_id = ${customerId} AND status <> 'CANCELLED' AND grand_total - paid_amount - returned_amount > 0.004`,
  ])
  const docs = [
    ...bills.map((b) => ({ kind: 'INV' as const, id: b.id, docNo: b.docNo, docDate: b.docDate, grandTotal: Number(b.grandTotal), dueAmount: dueOf(b) })),
    ...jobs.map((j) => ({ kind: 'JOB' as const, id: j.id, docNo: j.doc_no, docDate: j.doc_date, grandTotal: Number(j.grand_total), dueAmount: r2(Number(j.due)) })),
  ]
  return docs.sort((a, b) => a.docDate.getTime() - b.docDate.getTime() || a.id - b.id)
}
