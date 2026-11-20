import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import { toDocDate } from '../../utils/financialYear'
import type { ItemMeasurementsInput } from '../../validators/workshop.validator'
import { audit } from '../audit.service'
import { getOrder } from '../brands/brandOrder.query'
import { getJob } from '../jobs/job.query'

// Measurements of one garment, added or corrected AFTER booking — also after delivery (the counter often bills
// first so the customer doesn't wait). Only the measurements change: money, tailor pay and the bill stay as they are.

const clean = (m: ItemMeasurementsInput['measurements']) => Object.fromEntries(Object.entries(m).filter(([, v]) => v.trim()))
const filled = (m: Record<string, string>) => Object.keys(m).length

// Job garment: the job keeps them, and the customer's history gets the set so the next booking fills them in.
export async function setJobItemMeasurements(jobId: number, itemId: number, input: ItemMeasurementsInput, user: string) {
  const item = await prisma.jobItem.findFirst({ where: { id: itemId, jobId }, include: { job: { select: { docNo: true, status: true, customerId: true } }, garmentType: { select: { name: true } } } })
  if (!item) throw ApiError.notFound('Garment line not found')
  if (item.job.status === 'CANCELLED') throw ApiError.conflict(`${item.job.docNo} is cancelled`)
  if (!item.garmentTypeId) throw ApiError.badRequest(`${item.description} is work without a garment — it has no measurements`)
  const values = clean(input.measurements)
  const { date } = toDocDate(undefined)
  await prisma.$transaction(async (tx) => {
    await tx.jobItem.update({ where: { id: itemId }, data: { measurements: values } })
    if (filled(values)) {
      await tx.customerMeasurement.create({ data: { customerId: item.job.customerId, garmentTypeId: item.garmentTypeId!, values, takenOn: date, notes: `From ${item.job.docNo}`, createdBy: user } })
    }
    await audit(tx, { actor: user, action: 'job.measurements', entity: 'job', entityId: jobId, summary: `${item.job.docNo}: ${item.description} measurements saved (${filled(values)} filled)` })
  })
  return getJob(jobId)
}

// Brand order piece (their customer has no record with us, so only the piece keeps them). Work-only lines have none.
export async function setBrandItemMeasurements(orderId: number, itemId: number, input: ItemMeasurementsInput, user: string) {
  const item = await prisma.brandOrderItem.findFirst({ where: { id: itemId, orderId }, include: { order: { select: { docNo: true, status: true } } } })
  if (!item) throw ApiError.notFound('Piece not found')
  if (item.order.status === 'CANCELLED') throw ApiError.conflict(`${item.order.docNo} is cancelled`)
  if (!item.garmentTypeId) throw ApiError.badRequest(`${item.description} is work without a garment — it has no measurements`)
  const values = clean(input.measurements)
  await prisma.$transaction(async (tx) => {
    await tx.brandOrderItem.update({ where: { id: itemId }, data: { measurements: values } })
    await audit(tx, { actor: user, action: 'brandOrder.measurements', entity: 'brandOrder', entityId: orderId, summary: `${item.order.docNo}: ${item.description}${item.endCustomer ? ` (${item.endCustomer})` : ''} measurements saved (${filled(values)} filled)` })
  })
  return getOrder(orderId)
}
