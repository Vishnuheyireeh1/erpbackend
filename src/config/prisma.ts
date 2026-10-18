import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'
import { databaseUrl } from './env'

// Single shared Prisma client (uses the pg driver adapter under the hood).
const adapter = new PrismaPg({ connectionString: databaseUrl })

export const prisma = new PrismaClient({ adapter })
