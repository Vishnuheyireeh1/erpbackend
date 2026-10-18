import { prisma } from '../src/config/prisma'
import { seedAdmin } from './seeds/admin.seed'
import { seedGarments } from './seeds/garments.seed'
import { seedMasters } from './seeds/masters.seed'

// npm run db:seed — every step is safe to re-run (existing data is never overwritten).
async function main() {
  await seedAdmin()
  await seedMasters()
  await seedGarments()
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
