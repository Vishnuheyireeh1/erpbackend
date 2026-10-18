import type { CookieOptions, Request, Response } from 'express'
import { env } from '../config/env'
import * as authService from '../services/auth.service'
import type { ChangePasswordInput, LoginInput } from '../validators/auth.validator'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

// httpOnly = JavaScript can't read it (safer than localStorage).
const cookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.cookieSecure,
  path: '/',
}

function setSessionCookie(res: Response, token: string) {
  res.cookie(env.auth.cookieName, token, { ...cookieOptions, maxAge: SEVEN_DAYS_MS })
}

export async function login(req: Request, res: Response) {
  const { username, password } = req.body as LoginInput
  const { admin, token } = await authService.login(username, password)
  setSessionCookie(res, token)
  res.json({ success: true, admin })
}

export function logout(_req: Request, res: Response) {
  res.clearCookie(env.auth.cookieName, cookieOptions)
  res.json({ success: true })
}

export async function me(req: Request, res: Response) {
  const admin = await authService.getMe(req.admin!.id)
  res.json({ success: true, admin })
}

export async function changePassword(req: Request, res: Response) {
  const { currentPassword, newPassword } = req.body as ChangePasswordInput
  const token = await authService.changePassword(req.admin!.id, currentPassword, newPassword)
  setSessionCookie(res, token)
  res.json({ success: true, message: 'Password changed' })
}
