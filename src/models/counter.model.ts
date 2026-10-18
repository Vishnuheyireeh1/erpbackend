import type { Prisma } from '../generated/prisma/client'

// Atomic running numbers (INSERT … ON CONFLICT DO UPDATE) — safe with parallel requests.
// Always call inside the same transaction that uses the number.
export async function nextValue(tx: Prisma.TransactionClient, key: string, count = 1) {
  const row = await tx.counter.upsert({
    where: { key },
    create: { key, value: count },
    update: { value: { increment: count } },
  })
  // Returns the first number of the reserved block.
  return row.value - count + 1
}
