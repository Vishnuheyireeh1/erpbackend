import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { amountInWords } from '../../utils/amountWords'
import { ApiError } from '../../utils/ApiError'
import { dateRange, todayIST } from '../../utils/financialYear'
import type { JobListQuery } from '../../validators/job.validator'
import { calcJob, materialForCalc } from './job.calc'

const r2 = (n: number) => Math.round(n * 100) / 100
const OPEN = { notIn: ['DELIVERED', 'CANCELLED'] } as Prisma.EnumJobStatusFilter
const today = () => new Date(`${todayIST()}T00:00:00Z`)

async function unpaidJobIds() {
  const rows = await prisma.$queryRaw<{ id: number }[]>`SELECT id FROM stitching_jobs WHERE status <> 'CANCELLED' AND grand_total - paid_amount - returned_amount > 0.004`
  return rows.map((r) => r.id)
}

// Same filters for the list screen and the Excel download.
export async function jobWhere(q: Omit<JobListQuery, 'page' | 'pageSize'>) {
  const where: Prisma.StitchingJobWhereInput = {}
  if (q.view === 'open') where.status = OPEN
  if (q.view === 'due') Object.assign(where, { status: OPEN, expectedDate: { lte: today() } })
  if (q.view === 'overdue') Object.assign(where, { status: OPEN, expectedDate: { lt: today() } })
  if (q.view === 'ready') where.status = 'READY'
  if (q.view === 'delivered') where.status = 'DELIVERED'
  if (q.view === 'cancelled') where.status = 'CANCELLED'
  if (q.view === 'unpaid') where.id = { in: await unpaidJobIds() }
  // Workshop to do: open jobs with a garment that has no tailor yet.
  if (q.view === 'unassigned') Object.assign(where, { status: OPEN, items: { some: { tailorId: null } } })
  if (q.status) where.status = q.status
  if (q.customerId) where.customerId = q.customerId
  if (q.tailorId) where.items = { some: { tailorId: q.tailorId } }
  const range = dateRange(q.from, q.to)
  if (range) where.docDate = range
  if (q.search) {
    const s = q.search
    where.OR = [
      { docNo: { contains: s, mode: 'insensitive' } },
      { bookNo: { equals: s, mode: 'insensitive' } },
      { customerName: { contains: s, mode: 'insensitive' } },
      { customerPhone: { contains: s.replace(/\s/g, '') } },
    ]
  }
  return where
}

const isOpenView = (v: JobListQuery['view']) => ['open', 'due', 'overdue', 'ready'].includes(v)

export async function listJobs(q: JobListQuery) {
  const where = await jobWhere(q)
  // Open tabs: soonest ready-by first; the rest: newest booking first — "oldest first" on screen flips either.
  const flip = q.order === 'oldest'
  const orderBy: Prisma.StitchingJobOrderByWithRelationInput[] = isOpenView(q.view)
    ? [{ expectedDate: flip ? 'desc' : 'asc' }, { id: flip ? 'desc' : 'asc' }]
    : [{ docDate: flip ? 'asc' : 'desc' }, { id: flip ? 'asc' : 'desc' }]
  const [items, total, counts] = await Promise.all([
    prisma.stitchingJob.findMany({
      where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      include: { items: { select: { description: true, qty: true, tailor: { select: { name: true } } }, orderBy: { sortOrder: 'asc' } } },
    }),
    prisma.stitchingJob.count({ where }),
    // Tab badges: what needs attention today.
    Promise.all([
      prisma.stitchingJob.count({ where: { status: OPEN, expectedDate: { lt: today() } } }),
      prisma.stitchingJob.count({ where: { status: OPEN, expectedDate: today() } }),
      prisma.stitchingJob.count({ where: { status: 'READY' } }),
    ]),
  ])
  const now = today().getTime()
  return {
    items: items.map((j) => ({
      ...j,
      dueAmount: j.status === 'CANCELLED' ? 0 : Math.max(0, r2(Number(j.grandTotal) - Number(j.paidAmount) - Number(j.returnedAmount))),
      overdue: j.status !== 'DELIVERED' && j.status !== 'CANCELLED' && j.expectedDate.getTime() < now,
    })),
    total, page: q.page, pageSize: q.pageSize,
    counts: { overdue: counts[0], dueToday: counts[1], ready: counts[2] },
  }
}

export async function getJob(id: number) {
  const job = await prisma.stitchingJob.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, code: true, name: true, phone: true, address: true, city: true } },
      parentJob: { select: { id: true, docNo: true } },
      alterations: { select: { id: true, docNo: true, status: true }, orderBy: { id: 'asc' } },
      items: { orderBy: { sortOrder: 'asc' }, include: { garmentType: { select: { name: true, fields: true } }, tailor: { select: { id: true, name: true, payType: true } } } },
      materials: { orderBy: { id: 'asc' }, include: { variant: { select: { id: true, sku: true, product: { select: { unit: { select: { code: true } } } } } } } },
      costs: { orderBy: { id: 'asc' } },
      costEntries: { orderBy: [{ date: 'asc' }, { id: 'asc' }], include: { category: { select: { id: true, name: true } }, tailor: { select: { id: true, code: true, name: true, payType: true } } } },
      logs: { orderBy: { id: 'desc' } },
      allocations: { where: { receipt: { status: 'POSTED' } }, include: { receipt: { select: { id: true, docNo: true, docDate: true, tenders: true } } } },
      creditAllocations: { include: { return: { select: { id: true, docNo: true } } } },
      returns: { orderBy: { id: 'asc' }, select: { id: true, docNo: true, docDate: true, grandTotal: true, refundAmount: true, status: true } },
    },
  })
  if (!job) throw ApiError.notFound('Job not found')
  const { cost } = calcJob({
    items: job.items.map((i) => ({ qty: i.qty, chargeRate: Number(i.chargeRate), labourRate: Number(i.labourRate) })),
    materials: job.materials.map(materialForCalc),
    costs: job.costs.map((c) => ({ charge: Number(c.charge) })),
    entries: job.costEntries.map((e) => ({ amount: Number(e.amount) })),
    discount: Number(job.discount), gstRate: Number(job.gstRate), taxMode: job.taxMode,
  })
  const open = job.status !== 'DELIVERED' && job.status !== 'CANCELLED'
  return {
    ...job,
    dueAmount: job.status === 'CANCELLED' ? 0 : Math.max(0, r2(Number(job.grandTotal) - Number(job.paidAmount) - Number(job.returnedAmount))),
    overdue: open && job.expectedDate.getTime() < today().getTime(),
    amountInWords: amountInWords(Number(job.grandTotal)),
    cost,
  }
}
