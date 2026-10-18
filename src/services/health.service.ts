import { prisma } from '../config/prisma'

// Checks that the API process and the database are both reachable.
export async function getHealth() {
  let database = 'connected'
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    database = 'unreachable'
  }
  return { status: 'ok', database, time: new Date().toISOString() }
}
