import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import { toDocDate } from '../../utils/financialYear'
import type { MeasurementInput } from '../../validators/workshop.validator'
import { audit } from '../audit.service'

// Customer measurements — history per garment. A new visit adds a row; old rows stay for reference.

const select = { id: true, garmentTypeId: true, values: true, notes: true, takenOn: true, createdBy: true, createdAt: true, garmentType: { select: { name: true } } } as const

// All measurements of a customer, newest first (the first row per garment = the latest).
export async function listForCustomer(customerId: number) {
  const exists = await prisma.customer.count({ where: { id: customerId } })
  if (!exists) throw ApiError.notFound('Customer not found')
  return prisma.customerMeasurement.findMany({ where: { customerId }, orderBy: [{ takenOn: 'desc' }, { id: 'desc' }], select })
}

// Latest measurement of one garment — used to pre-fill a new job / a new visit.
export function latest(customerId: number, garmentTypeId: number) {
  return prisma.customerMeasurement.findFirst({ where: { customerId, garmentTypeId }, orderBy: [{ takenOn: 'desc' }, { id: 'desc' }], select })
}

export async function create(customerId: number, input: MeasurementInput, user: string) {
  const { date, isFuture } = toDocDate(input.takenOn)
  if (isFuture) throw ApiError.badRequest("Date can't be in the future")
  const [customer, garment] = await Promise.all([
    prisma.customer.findUnique({ where: { id: customerId }, select: { code: true, name: true } }),
    prisma.garmentType.findUnique({ where: { id: input.garmentTypeId }, select: { name: true, isActive: true } }),
  ])
  if (!customer) throw ApiError.notFound('Customer not found')
  if (!garment) throw ApiError.badRequest('Garment type not found')
  if (!garment.isActive) throw ApiError.badRequest(`${garment.name} is inactive`)
  return prisma.$transaction(async (tx) => {
    const m = await tx.customerMeasurement.create({
      data: { customerId, garmentTypeId: input.garmentTypeId, values: input.values, notes: input.notes, takenOn: date, createdBy: user },
      select,
    })
    await audit(tx, { actor: user, action: 'measurement.create', entity: 'customer_measurement', entityId: m.id, summary: `${garment.name} measurements for ${customer.code} ${customer.name}` })
    return m
  })
}

// Delete a wrongly entered set. Jobs keep their own copy of the measurements, so nothing else changes.
export async function remove(customerId: number, id: number, user: string) {
  const m = await prisma.customerMeasurement.findFirst({ where: { id, customerId }, include: { garmentType: { select: { name: true } } } })
  if (!m) throw ApiError.notFound('Measurement not found')
  await prisma.$transaction(async (tx) => {
    await tx.customerMeasurement.delete({ where: { id } })
    await audit(tx, { actor: user, action: 'measurement.delete', entity: 'customer_measurement', entityId: id, summary: `${m.garmentType.name} measurements of ${m.takenOn.toISOString().slice(0, 10)} deleted (customer ${customerId})` })
  })
}
