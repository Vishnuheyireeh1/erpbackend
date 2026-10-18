import bcrypt from 'bcryptjs'
import { prisma } from '../../src/config/prisma'

// Creates the admin account from ADMIN_USERNAME / ADMIN_PASSWORD in .env.
// An existing admin is never overwritten (change the password in the app).
export async function seedAdmin() {
  const username = process.env.ADMIN_USERNAME?.trim()
  const password = process.env.ADMIN_PASSWORD
  if (!username || !password) throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD in .env')
  if (password.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters')

  const existing = await prisma.admin.findFirst()
  if (existing) {
    console.log(`[seed] Admin "${existing.username}" already exists — skipped.`)
    return
  }

  const passwordHash = await bcrypt.hash(password, 12)
  await prisma.admin.create({ data: { username, passwordHash } })
  console.log(`[seed] Admin "${username}" created.`)
}
