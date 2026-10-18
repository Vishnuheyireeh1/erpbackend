import { prisma } from '../config/prisma'

// Data access for the admin account (no business rules here).

export function findByUsername(username: string) {
  return prisma.admin.findFirst({
    where: { username: { equals: username, mode: 'insensitive' } },
  })
}

export function findById(id: number) {
  return prisma.admin.findUnique({ where: { id } })
}

export function touchLastLogin(id: number) {
  return prisma.admin.update({ where: { id }, data: { lastLoginAt: new Date() } })
}

// New password + bump token version (logs out every other session).
export function updatePassword(id: number, passwordHash: string) {
  return prisma.admin.update({
    where: { id },
    data: { passwordHash, tokenVersion: { increment: 1 } },
  })
}
