import { Prisma, type MovementType } from '../../generated/prisma/client'
import { ApiError } from '../../utils/ApiError'

// THE ONLY PLACE STOCK CHANGES. Every module (adjustment, purchase, sale, job …) calls postMovements
// inside its own transaction, so the document and the stock change commit or roll back together.

export type MovementInput = {
  variantId: number
  qty: number // signed: + in, − out
  type: MovementType
  unitCost?: number // in: cost of the incoming goods (defaults to current average). out: defaults to average
  note?: string | null
}

export type PostContext = {
  refType: string // "OPN", "ADJ", "PUR", "INV" …
  refId: number
  refNo: string
  date: Date
  user: string
  allowNegative: boolean
}

type Locked = {
  id: number
  sku: string
  name: string
  type: string
  allow_decimal: boolean
  stock_qty: Prisma.Decimal
  avg_cost: Prisma.Decimal
  stock_value: Prisma.Decimal
}

const r2 = (n: number) => Math.round(n * 100) / 100
const r3 = (n: number) => Math.round(n * 1000) / 1000
const r4 = (n: number) => Math.round(n * 10000) / 10000

// PostgreSQL allows ~65k values per query → big documents (1 lakh-line opening stock) go in chunks.
const LOCK_CHUNK = 10_000
const INSERT_CHUNK = 2_000
const UPDATE_CHUNK = 5_000

// Locks the variant rows (FOR UPDATE, in id order → no deadlocks) until the transaction ends.
async function lockVariants(tx: Prisma.TransactionClient, ids: number[]) {
  const map = new Map<number, Locked>()
  for (let i = 0; i < ids.length; i += LOCK_CHUNK) {
    const rows = await tx.$queryRaw<Locked[]>`
      SELECT v.id, v.sku, p.name, p.type::text AS type, u.allow_decimal,
             v.stock_qty, v.avg_cost, v.stock_value
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      JOIN units u ON u.id = p.unit_id
      WHERE v.id IN (${Prisma.join(ids.slice(i, i + LOCK_CHUNK))})
      ORDER BY v.id
      FOR UPDATE OF v`
    rows.forEach((r) => map.set(r.id, r))
  }
  return map
}

// Writes the new balances back in bulk (one UPDATE … FROM VALUES per chunk).
async function saveBalances(tx: Prisma.TransactionClient, state: Map<number, { qty: number; avg: number; value: number }>) {
  const rows = [...state.entries()]
  for (let i = 0; i < rows.length; i += UPDATE_CHUNK) {
    const values = rows
      .slice(i, i + UPDATE_CHUNK)
      .map(([id, s]) => Prisma.sql`(${id}::int, ${s.qty}::numeric, ${s.avg}::numeric, ${s.value}::numeric)`)
    await tx.$executeRaw`
      UPDATE product_variants AS v
      SET stock_qty = x.qty, avg_cost = x.avg, stock_value = x.value, updated_at = now()
      FROM (VALUES ${Prisma.join(values)}) AS x(id, qty, avg, value)
      WHERE v.id = x.id`
  }
}

// Applies movements with weighted-average costing; returns the cost actually used per line.
export async function postMovements(tx: Prisma.TransactionClient, items: MovementInput[], ctx: PostContext) {
  if (items.length === 0) return []
  const ids = [...new Set(items.map((i) => i.variantId))].sort((a, b) => a - b)
  const locked = await lockVariants(tx, ids)
  const state = new Map(
    [...locked.values()].map((v) => [v.id, { qty: Number(v.stock_qty), avg: Number(v.avg_cost), value: Number(v.stock_value) }]),
  )

  const rows: Prisma.StockMovementCreateManyInput[] = []
  const applied: { variantId: number; qty: number; unitCost: number; value: number }[] = []

  for (const item of items) {
    const v = locked.get(item.variantId)
    if (!v) throw ApiError.badRequest(`Item #${item.variantId} no longer exists`)
    if (v.type === 'SERVICE') throw ApiError.badRequest(`${v.name} is a service — it has no stock`)
    const qty = r3(item.qty)
    if (qty === 0) throw ApiError.badRequest(`Quantity for ${v.sku} can't be zero`)
    if (!v.allow_decimal && !Number.isInteger(qty)) {
      throw ApiError.badRequest(`${v.sku} is counted in whole numbers — ${qty} isn't allowed`)
    }

    const s = state.get(v.id)!
    const unitCost = r4(item.unitCost ?? s.avg)
    const newQty = r3(s.qty + qty)

    if (qty > 0) {
      // Stock in: blend the new cost into the average. From zero / negative → start fresh.
      s.value = s.qty <= 0 ? r2(newQty * unitCost) : r2(s.value + qty * unitCost)
      s.avg = newQty > 0 ? r4(s.value / newQty) : unitCost
    } else {
      if (newQty < 0 && !ctx.allowNegative) {
        throw ApiError.badRequest(`Not enough stock for ${v.name} (${v.sku}): ${s.qty} available, ${-qty} needed`)
      }
      // Stock out — normally at the average cost (average unchanged). Returns / cancellations go out at
      // their ORIGINAL cost, so the average is re-derived from what's left (value ÷ qty).
      s.value = newQty === 0 ? 0 : r2(s.value + qty * unitCost)
      if (newQty > 0) s.avg = r4(s.value / newQty)
    }
    s.qty = newQty
    const value = r2(qty * unitCost)

    rows.push({
      variantId: v.id,
      type: item.type,
      qty,
      unitCost,
      value,
      balanceQty: s.qty,
      balanceValue: s.value,
      refType: ctx.refType,
      refId: ctx.refId,
      refNo: ctx.refNo,
      note: item.note ?? null,
      movementDate: ctx.date,
      createdBy: ctx.user,
    })
    applied.push({ variantId: v.id, qty, unitCost, value })
  }

  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await tx.stockMovement.createMany({ data: rows.slice(i, i + INSERT_CHUNK) })
  }
  await saveBalances(tx, state)
  return applied
}
