import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import { audit } from '../audit.service'
import { getJob } from '../jobs/job.query'
import { getSale } from './sale.query'

// Manual number from the paper bill / order book. Optional, and can be added or corrected later (it does not
// change any amount, so it is not a "document edit"). Same number on another bill / job → a warning only.

async function clash(kind: 'sale' | 'job', id: number, bookNo: string | null) {
  if (!bookNo) return null
  const other = kind === 'sale'
    ? await prisma.salesInvoice.findFirst({ where: { bookNo, id: { not: id }, status: 'POSTED' }, select: { docNo: true } })
    : await prisma.stitchingJob.findFirst({ where: { bookNo, id: { not: id }, status: { not: 'CANCELLED' } }, select: { docNo: true } })
  return other ? `SJ number ${bookNo} is also on ${other.docNo}` : null
}

export async function setSaleBookNo(id: number, bookNo: string | null, user: string) {
  const s = await prisma.salesInvoice.findUnique({ where: { id }, select: { docNo: true, bookNo: true } })
  if (!s) throw ApiError.notFound('Bill not found')
  await prisma.$transaction(async (tx) => {
    await tx.salesInvoice.update({ where: { id }, data: { bookNo } })
    await audit(tx, { actor: user, action: 'sale.book_no', entity: 'sale', entityId: id, summary: `${s.docNo}: SJ number ${s.bookNo ?? '—'} → ${bookNo ?? '—'}` })
  })
  return { item: await getSale(id), warning: await clash('sale', id, bookNo) }
}

export async function setJobBookNo(id: number, bookNo: string | null, user: string) {
  const j = await prisma.stitchingJob.findUnique({ where: { id }, select: { docNo: true, bookNo: true } })
  if (!j) throw ApiError.notFound('Job not found')
  await prisma.$transaction(async (tx) => {
    await tx.stitchingJob.update({ where: { id }, data: { bookNo } })
    await audit(tx, { actor: user, action: 'job.book_no', entity: 'job', entityId: id, summary: `${j.docNo}: SJ number ${j.bookNo ?? '—'} → ${bookNo ?? '—'}` })
  })
  return { item: await getJob(id), warning: await clash('job', id, bookNo) }
}

export const bookNoClash = clash
