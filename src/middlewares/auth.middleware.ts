import type { NextFunction, Request, Response } from 'express'
import { env } from '../config/env'
import * as adminModel from '../models/admin.model'
import { ApiError } from '../utils/ApiError'
import { verifyToken } from '../utils/jwt'

// Blocks the request unless it carries a valid, current login cookie.
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const payload = verifyToken(req.cookies?.[env.auth.cookieName])
  if (!payload) return next(ApiError.unauthorized())

  // Token version must match — a password change invalidates older logins.
  const admin = await adminModel.findById(payload.sub)
  if (!admin || admin.tokenVersion !== payload.tv) {
    return next(ApiError.unauthorized('Your session expired. Log in again.'))
  }

  req.admin = { id: admin.id, username: admin.username }
  next()
}
