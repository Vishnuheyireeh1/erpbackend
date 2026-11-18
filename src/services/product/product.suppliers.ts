import { prisma } from '../../config/prisma'

// Supplier of each product's latest posted purchase bill (product id → supplier name).
// Used when no supplier is picked on the product itself.
export async function latestSuppliers(productIds: number[]) {
  const found = new Map<number, string>()
  if (productIds.length === 0) return found
  const lines = await prisma.purchaseLine.findMany({
    where: { variant: { productId: { in: productIds } }, invoice: { status: 'POSTED' } },
    orderBy: [{ invoice: { docDate: 'desc' } }, { invoiceId: 'desc' }],
    distinct: ['variantId'],
    select: { variant: { select: { productId: true } }, invoice: { select: { docDate: true, supplier: { select: { name: true } } } } },
  })
  // One row per variant (its latest bill) → keep the newest per product (rows are already newest first).
  for (const l of lines) if (!found.has(l.variant.productId)) found.set(l.variant.productId, l.invoice.supplier.name)
  return found
}

// Name to show: the supplier picked on the product, else the latest purchase bill's supplier.
export const supplierName = (p: { id: number; supplier: { name: string } | null }, latest: Map<number, string>) =>
  p.supplier?.name ?? latest.get(p.id) ?? null
