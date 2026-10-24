import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import { toDocDate } from '../../utils/financialYear'
import type { JobAddItemsInput } from '../../validators/job.validator'
import { audit } from '../audit.service'
import { postMovements } from '../inventory/stock.engine'
import { deleteImage, saveImage } from '../product/product.image'
import { getSetting } from '../settings.service'
import { postLinesTx, priceLines, soldTotal, takePaymentTx } from './job.items'
import { getJob } from './job.query'
import { lockOpenJob, recalcJobTx } from './job.rules'

const TX = { timeout: 30_000, maxWait: 20_000 }

// Add items to an open job (at booking time or when the customer comes to collect). Sold items are paid now.
export async function addItems(jobId: number, input: JobAddItemsInput, user: string) {
  const head = await prisma.stitchingJob.findUnique({ where: { id: jobId }, select: { taxMode: true } })
  if (!head) throw ApiError.notFound('Job not found')
  const lines = await priceLines(input.lines, head.taxMode)
  const itemsDue = soldTotal(lines)
  const allowNegative = await getSetting('inventory.allowNegativeStock')
  const { date } = toDocDate(undefined)
  await prisma.$transaction(async (tx) => {
    const job = await lockOpenJob(tx, jobId)
    await postLinesTx(tx, job, lines, { user, date, allowNegative })
    await recalcJobTx(tx, jobId)
    const pay = await takePaymentTx(tx, jobId, { itemsDue, tenders: input.tenders, useAdvance: input.useAdvance, date, user, note: `Items on ${job.docNo}` })
    await audit(tx, {
      actor: user, action: 'job.items.add', entity: 'job', entityId: jobId,
      summary: `${job.docNo}: ${lines.map((l) => `${l.qty} × ${l.description}${l.included ? ' (used)' : ` ₹${l.amount}`}`).join(', ')}${pay.paid ? `, paid ₹${pay.paid}` : ''}${pay.advance ? `, advance used ₹${pay.advance}` : ''}`,
    })
  }, TX)
  return getJob(jobId)
}

// Only material USED for the stitching can be taken off (back to stock). Sold items go through a sales return.
export async function removeItem(jobId: number, materialId: number, user: string) {
  const allowNegative = await getSetting('inventory.allowNegativeStock')
  await prisma.$transaction(async (tx) => {
    const job = await lockOpenJob(tx, jobId)
    const m = await tx.jobMaterial.findFirst({ where: { id: materialId, jobId } })
    if (!m) throw ApiError.notFound('Item line not found')
    if (!m.included) throw ApiError.badRequest(`${m.description} was sold to the customer — use "Items returned" instead`)
    await postMovements(
      tx,
      [{ variantId: m.variantId, qty: Number(m.qty), unitCost: Number(m.unitCost), type: 'CANCELLATION', note: `Removed from ${job.docNo}` }],
      { refType: 'JOB', refId: jobId, refNo: job.docNo, date: toDocDate(undefined).date, user, allowNegative },
    )
    await tx.jobMaterial.delete({ where: { id: materialId } })
    await recalcJobTx(tx, jobId)
    await audit(tx, { actor: user, action: 'job.material.remove', entity: 'job', entityId: jobId, summary: `${job.docNo}: ${m.qty} × ${m.description} back to stock` })
  }, TX)
  return getJob(jobId)
}

// Who took the measurements of a garment — set at billing, or later on the job page (null = not recorded).
export async function setMeasuredBy(jobId: number, itemId: number, staffId: number | null, user: string) {
  const item = await prisma.jobItem.findFirst({ where: { id: itemId, jobId }, include: { job: { select: { docNo: true } } } })
  if (!item) throw ApiError.notFound('Garment line not found')
  const staff = staffId ? await prisma.staff.findUnique({ where: { id: staffId }, select: { id: true, name: true } }) : null
  if (staffId && !staff) throw ApiError.badRequest('Choose the staff member again')
  await prisma.$transaction(async (tx) => {
    await tx.jobItem.update({ where: { id: itemId }, data: { measuredById: staff?.id ?? null } })
    await audit(tx, { actor: user, action: 'job.measuredBy', entity: 'job', entityId: jobId, summary: `${item.job.docNo}: ${item.description} measured by ${staff?.name ?? '— (cleared)'}` })
  })
  return getJob(jobId)
}

// Reference design photo for one garment line (replaces the old one).
export async function setItemPhoto(jobId: number, itemId: number, buf: Buffer | undefined, user: string) {
  const item = await prisma.jobItem.findFirst({ where: { id: itemId, jobId }, include: { job: { select: { docNo: true, status: true } } } })
  if (!item) throw ApiError.notFound('Garment line not found')
  if (item.job.status === 'CANCELLED') throw ApiError.conflict(`${item.job.docNo} is cancelled`)
  const imagePath = buf ? await saveImage(buf, 'jobs') : null
  await prisma.$transaction(async (tx) => {
    await tx.jobItem.update({ where: { id: itemId }, data: { imagePath } })
    await audit(tx, { actor: user, action: imagePath ? 'job.photo.set' : 'job.photo.remove', entity: 'job', entityId: jobId, summary: `${item.job.docNo}: design photo ${imagePath ? 'added' : 'removed'} (${item.description})` })
  })
  await deleteImage(item.imagePath, 'jobs')
  return imagePath
}
