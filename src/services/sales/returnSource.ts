import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'

// What a sales return is made against: a counter bill (INV) or the items SOLD on a stitching job (JOB).

type Tx = Prisma.TransactionClient
export type SourceLine = { id: number; variantId: number; description: string; qty: number; returnedQty: number; amount: number; taxable: number; unitCost: number; isService: boolean }
export type ReturnSource = { kind: 'INV' | 'JOB'; id: number; docNo: string; customerId: number | null; lines: Map<number, SourceLine> }

const isService = (v: { product: { type: string } }) => v.product.type === 'SERVICE'
const variantType = { select: { product: { select: { type: true } } } } as const

export async function loadSource(target: { invoiceId?: number; jobId?: number }): Promise<ReturnSource> {
  if (target.invoiceId) {
    const bill = await prisma.salesInvoice.findUnique({ where: { id: target.invoiceId }, include: { lines: { include: { variant: variantType } } } })
    if (!bill) throw ApiError.notFound('Sales bill not found')
    if (bill.status !== 'POSTED') throw ApiError.badRequest(`${bill.docNo} is cancelled`)
    const lines = bill.lines.map((l) => ({
      id: l.id, variantId: l.variantId, description: l.description, qty: Number(l.qty), returnedQty: Number(l.returnedQty),
      amount: Number(l.amount), taxable: Number(l.taxable), unitCost: Number(l.unitCost), isService: isService(l.variant),
    }))
    return { kind: 'INV', id: bill.id, docNo: bill.docNo, customerId: bill.customerId, lines: new Map(lines.map((l) => [l.id, l])) }
  }
  const job = await prisma.stitchingJob.findUnique({ where: { id: target.jobId }, include: { materials: { where: { included: false }, include: { variant: variantType } } } })
  if (!job) throw ApiError.notFound('Job not found')
  if (job.status === 'CANCELLED') throw ApiError.badRequest(`${job.docNo} is cancelled`)
  const lines = job.materials.map((m) => ({
    id: m.id, variantId: m.variantId, description: m.description, qty: Number(m.qty), returnedQty: Number(m.returnedQty),
    amount: Number(m.amount), taxable: Number(m.taxable), unitCost: Number(m.unitCost), isService: isService(m.variant),
  }))
  return { kind: 'JOB', id: job.id, docNo: job.docNo, customerId: job.customerId, lines: new Map(lines.map((l) => [l.id, l])) }
}

// Locks the bill / job row and returns what is still due on it.
export async function lockDue(tx: Tx, src: Pick<ReturnSource, 'kind' | 'id'>) {
  const [row] = src.kind === 'INV'
    ? await tx.$queryRaw<{ due: unknown }[]>`SELECT grand_total - paid_amount - returned_amount AS due FROM sales_invoices WHERE id = ${src.id} FOR UPDATE`
    : await tx.$queryRaw<{ due: unknown }[]>`SELECT grand_total - paid_amount - returned_amount AS due FROM stitching_jobs WHERE id = ${src.id} FOR UPDATE`
  return Math.max(0, Number(row.due))
}

// returned_qty + qty, refused if it would pass the sold quantity (two returns at once).
export async function addReturnedQty(tx: Tx, kind: 'INV' | 'JOB', lineId: number, qty: number) {
  const ok = kind === 'INV'
    ? await tx.$executeRaw`UPDATE sales_lines SET returned_qty = returned_qty + ${qty}::numeric WHERE id = ${lineId} AND returned_qty + ${qty}::numeric <= qty`
    : await tx.$executeRaw`UPDATE job_materials SET returned_qty = returned_qty + ${qty}::numeric WHERE id = ${lineId} AND returned_qty + ${qty}::numeric <= qty`
  if (ok === 0) throw ApiError.conflict('Another return was saved meanwhile — reload and try again')
}

export async function addReturnedAmount(tx: Tx, kind: 'INV' | 'JOB', id: number, amount: number) {
  if (kind === 'INV') await tx.salesInvoice.update({ where: { id }, data: { returnedAmount: { increment: amount } } })
  else await tx.stitchingJob.update({ where: { id }, data: { returnedAmount: { increment: amount } } })
}
