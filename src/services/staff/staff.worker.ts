import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { nextValue } from '../../models/counter.model'
import { ApiError } from '../../utils/ApiError'
import type { StaffWorkInput } from '../../validators/staff.validator'
import { balances } from '../workshop/tailor.statement'

// A staff member who does job work has a worker profile (tailors table): per-piece or salaried, the work they do
// (stitching → own pay per garment; other work like Cutting / Lining / Embroidery → usual pay per piece) and an
// opening balance. Kept in step with the staff record — people are only created / edited in Staff & salary.
// Turning job work off keeps the history (profile made inactive).

type Tx = Prisma.TransactionClient
const r2 = (n: number) => Math.round(n * 100) / 100

export async function checkWork(work: StaffWorkInput | null) {
  if (!work) return
  const ids = [...new Set(work.rates.map((r) => r.garmentTypeId))]
  if (ids.length !== work.rates.length) throw ApiError.badRequest('A garment is listed twice in the pay rates')
  if (ids.length && (await prisma.garmentType.count({ where: { id: { in: ids } } })) !== ids.length) throw ApiError.badRequest('A garment in the pay rates no longer exists')
  const cats = [...new Set(work.works.map((w) => w.categoryId))]
  if (cats.length !== work.works.length) throw ApiError.badRequest('A work is ticked twice')
  if (cats.length && (await prisma.jobCostCategory.count({ where: { id: { in: cats } } })) !== cats.length) throw ApiError.badRequest('A ticked work no longer exists — reload')
  if (!work.stitches && !cats.length) throw ApiError.badRequest('Tick the work they do (Stitching, Cutting …)')
}

export async function syncWorkerTx(tx: Tx, staff: { id: number; name: string; phone: string | null; role: string; isActive: boolean }, work: StaffWorkInput | null) {
  const existing = await tx.tailor.findUnique({ where: { staffId: staff.id } })
  if (!work) {
    if (existing?.isActive) await tx.tailor.update({ where: { id: existing.id }, data: { isActive: false, name: staff.name, phone: staff.phone } })
    return existing ? `job work off (${existing.code} kept for history)` : ''
  }
  const data = { name: staff.name, phone: staff.phone, speciality: work.speciality ?? staff.role, payType: work.payType, stitches: work.stitches, openingBalance: work.openingBalance, isActive: staff.isActive }
  let id = existing?.id
  if (existing) {
    await tx.tailor.update({ where: { id: existing.id }, data })
    // rates and work are replaced as a whole set
    await tx.tailorRate.deleteMany({ where: { tailorId: existing.id } })
    await tx.tailorWork.deleteMany({ where: { tailorId: existing.id } })
  } else {
    const code = `T${String(await nextValue(tx, 'tailor')).padStart(3, '0')}`
    id = (await tx.tailor.create({ data: { ...data, code, staffId: staff.id } })).id
  }
  if (work.stitches && work.rates.length) await tx.tailorRate.createMany({ data: work.rates.map((r) => ({ ...r, tailorId: id! })) })
  if (work.works.length) await tx.tailorWork.createMany({ data: work.works.map((w) => ({ ...w, tailorId: id! })) })
  return `job work: ${work.payType === 'PIECE' ? 'per piece' : 'on salary'}`
}

// Worker profiles of these staff members, with balance (opening + earned − paid).
export async function workersOf(staffIds: number[]) {
  const ws = await prisma.tailor.findMany({
    where: { staffId: { in: staffIds } },
    select: {
      id: true, code: true, staffId: true, payType: true, stitches: true, speciality: true, openingBalance: true, isActive: true,
      rates: { select: { garmentTypeId: true, rate: true } }, works: { select: { categoryId: true, rate: true } },
    },
  })
  const b = await balances(ws.map((w) => w.id))
  return new Map(ws.map((w) => {
    const x = b.get(w.id)!
    return [w.staffId!, { ...w, earned: x.earned, paid: x.paid, balance: r2(Number(w.openingBalance) + x.earned - x.paid) }]
  }))
}
