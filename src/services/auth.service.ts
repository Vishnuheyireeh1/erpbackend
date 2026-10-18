import bcrypt from 'bcryptjs'
import * as adminModel from '../models/admin.model'
import { ApiError } from '../utils/ApiError'
import { signToken } from '../utils/jwt'

const BCRYPT_ROUNDS = 12

// Only these fields ever leave the server.
export type PublicAdmin = { id: number; username: string; lastLoginAt: Date | null }

function toPublic(admin: { id: number; username: string; lastLoginAt: Date | null }): PublicAdmin {
  return { id: admin.id, username: admin.username, lastLoginAt: admin.lastLoginAt }
}

export async function login(username: string, password: string) {
  const admin = await adminModel.findByUsername(username)
  // Same message for wrong username or wrong password — don't reveal which.
  const ok = admin ? await bcrypt.compare(password, admin.passwordHash) : false
  if (!admin || !ok) throw ApiError.unauthorized('Incorrect username or password')

  const updated = await adminModel.touchLastLogin(admin.id)
  const token = signToken({ sub: admin.id, tv: admin.tokenVersion })
  return { admin: toPublic(updated), token }
}

export async function getMe(adminId: number) {
  const admin = await adminModel.findById(adminId)
  if (!admin) throw ApiError.unauthorized()
  return toPublic(admin)
}

// Returns a fresh token so the current device stays logged in; others are logged out.
export async function changePassword(adminId: number, currentPassword: string, newPassword: string) {
  const admin = await adminModel.findById(adminId)
  if (!admin) throw ApiError.unauthorized()

  const ok = await bcrypt.compare(currentPassword, admin.passwordHash)
  if (!ok) throw ApiError.badRequest('Current password is incorrect')
  if (currentPassword === newPassword) {
    throw ApiError.badRequest('New password must be different from the current one')
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
  const updated = await adminModel.updatePassword(admin.id, passwordHash)
  return signToken({ sub: updated.id, tv: updated.tokenVersion })
}
