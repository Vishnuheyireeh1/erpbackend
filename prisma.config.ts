import { defineConfig } from 'prisma/config'
import { databaseUrl } from './src/config/env'

// Prisma CLI config — schema is split into files under prisma/ (see prisma/models/*).
export default defineConfig({
  schema: 'prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: { url: databaseUrl },
})
