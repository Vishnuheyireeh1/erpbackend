import { prisma } from '../../config/prisma'
import type { AdjustmentReason, Prisma, StockDocumentKind } from '../../generated/prisma/client'
import * as docModel from '../../models/stockDocument.model'
import { ApiError } from '../../utils/ApiError'
import { nextDocNo, toDocDate } from '../../utils/financialYear'
import type { AdjustmentInput, DocumentListQuery, OpeningInput } from '../../validators/inventory.validator'
import { audit } from '../audit.service'
import { getSetting } from '../settings.service'
import { postMovements } from './stock.engine'

const TX = { timeout: 10 * 60_000, maxWait: 30_000 } // large opening-stock imports
const PREFIX: Record<StockDocumentKind, 'OPN' | 'ADJ'> = { OPENING: 'OPN', ADJUSTMENT: 'ADJ' }

type Line = { variantId: number; qty: number; unitCost?: number }
export type NewDoc = { kind: StockDocumentKind; reason: AdjustmentReason; docDate?: string; note: string | null; lines: Line[] }

// Same item twice in one document → merge (keeps the ledger readable); costs are blended by quantity.
function mergeLines(lines: Line[]) {
  const map = new Map<string, Line>()
  for (const l of lines) {
    const key = `${l.variantId}|${Math.sign(l.qty)}`
    const prev = map.get(key)
    if (!prev) {
      map.set(key, { ...l })
      continue
    }
    const qty = prev.qty + l.qty
    const unitCost =
      prev.unitCost !== undefined && l.unitCost !== undefined
        ? (prev.qty * prev.unitCost + l.qty * l.unitCost) / qty
        : (prev.unitCost ?? l.unitCost)
    map.set(key, { ...prev, qty, unitCost })
  }
  return [...map.values()]
}

// Stock coming in without a typed cost → use the product's purchase price (never silently ₹0).
async function fillCosts(lines: Line[]) {
  const missing = lines.filter((l) => l.qty > 0 && l.unitCost === undefined).map((l) => l.variantId)
  if (missing.length === 0) return lines
  const rows = await prisma.productVariant.findMany({
    where: { id: { in: missing } },
    select: { id: true, purchasePrice: true },
  })
  const price = new Map(rows.map((r) => [r.id, Number(r.purchasePrice)]))
  return lines.map((l) => (l.qty > 0 && l.unitCost === undefined ? { ...l, unitCost: price.get(l.variantId) ?? 0 } : l))
}

export async function createDocument(input: NewDoc, user: string) {
  const { date, isFuture } = toDocDate(input.docDate)
  if (isFuture) throw ApiError.badRequest("Date can't be in the future")
  const allowNegative = await getSetting('inventory.allowNegativeStock')
  const lines = await fillCosts(mergeLines(input.lines))

  return prisma.$transaction((tx) => createDocumentTx(tx, { ...input, date, lines }, user, allowNegative).then((d) => d.id), TX)
}

// Inside a caller's transaction (e.g. product import + its opening stock — all or nothing). Lines need their cost.
export async function createDocumentTx(
  tx: Prisma.TransactionClient,
  input: Omit<NewDoc, 'docDate'> & { date: Date },
  user: string,
  allowNegative: boolean,
) {
  const { date, lines } = input
  const docNo = await nextDocNo(tx, PREFIX[input.kind], date)
  const doc = await tx.stockDocument.create({
    data: { docNo, kind: input.kind, reason: input.reason, docDate: date, note: input.note, createdBy: user },
  })
  const applied = await postMovements(
    tx,
    lines.map((l) => ({
      variantId: l.variantId,
      qty: l.qty,
      unitCost: l.qty > 0 ? l.unitCost : undefined, // out → always average cost
      type: input.kind === 'OPENING' ? 'OPENING' : l.qty > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
    })),
    { refType: PREFIX[input.kind], refId: doc.id, refNo: docNo, date, user, allowNegative },
  )
  const totalValue = applied.reduce((sum, a) => sum + a.value, 0)
  const lineRows = applied.map((a) => ({ documentId: doc.id, ...a }))
  for (let i = 0; i < lineRows.length; i += 5_000) {
    await tx.stockDocumentLine.createMany({ data: lineRows.slice(i, i + 5_000) })
  }
  await tx.stockDocument.update({ where: { id: doc.id }, data: { totalValue } })
  await audit(tx, {
    actor: user,
    action: 'stock_document.post',
    entity: 'stock_document',
    entityId: doc.id,
    summary: `${docNo} posted — ${applied.length} items, value ₹${totalValue.toFixed(2)}`,
  })
  return { id: doc.id, docNo, totalValue }
}

export async function createOpening(input: OpeningInput, user: string) {
  const id = await createDocument({ ...input, kind: 'OPENING', reason: 'OPENING' }, user)
  return getDocument(id)
}

export async function createAdjustment(input: AdjustmentInput, user: string) {
  const id = await createDocument({ ...input, kind: 'ADJUSTMENT' }, user)
  return getDocument(id)
}

// Cancel = add reversing ledger rows (same qty, same cost, opposite sign). Nothing is deleted.
export async function cancelDocument(id: number, reason: string, user: string) {
  const doc = await prisma.stockDocument.findUnique({ where: { id }, include: { lines: true } })
  if (!doc) throw ApiError.notFound('Document not found')
  if (doc.status === 'CANCELLED') throw ApiError.conflict(`${doc.docNo} is already cancelled`)
  const allowNegative = await getSetting('inventory.allowNegativeStock')
  const today = toDocDate(undefined).date

  await prisma.$transaction(async (tx) => {
    // Re-check inside the transaction (two people cancelling at once).
    // If the stock was already sold / used, the reversal fails the negative-stock check.
    const fresh = await tx.stockDocument.updateMany({
      where: { id, status: 'POSTED' },
      data: { status: 'CANCELLED', cancelledBy: user, cancelledAt: new Date(), cancelReason: reason },
    })
    if (fresh.count === 0) throw ApiError.conflict(`${doc.docNo} is already cancelled`)
    await postMovements(
      tx,
      doc.lines.map((l) => ({
        variantId: l.variantId,
        qty: -Number(l.qty),
        unitCost: Number(l.unitCost),
        type: 'CANCELLATION',
        note: `Cancelled ${doc.docNo}: ${reason}`,
      })),
      { refType: PREFIX[doc.kind], refId: doc.id, refNo: doc.docNo, date: today, user, allowNegative },
    )
    await audit(tx, {
      actor: user,
      action: 'stock_document.cancel',
      entity: 'stock_document',
      entityId: doc.id,
      summary: `${doc.docNo} cancelled — ${reason}`,
    })
  }, TX).catch((err) => {
    if (err instanceof ApiError && err.message.startsWith('Not enough stock')) {
      throw ApiError.conflict(`Can't cancel ${doc.docNo} — part of this stock is already used. ${err.message}`)
    }
    throw err
  })
  return getDocument(id)
}

export async function getDocument(id: number) {
  const doc = await docModel.findById(id)
  if (!doc) throw ApiError.notFound('Document not found')
  return doc
}

export function listDocuments(query: DocumentListQuery) {
  return docModel.list(query)
}
