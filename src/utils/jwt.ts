import jwt, { type SignOptions } from 'jsonwebtoken'
import { env } from '../config/env'

// What we store inside the login token: admin id + token version.
export type TokenPayload = { sub: number; tv: number }

export function signToken(payload: TokenPayload) {
  return jwt.sign(payload, env.auth.jwtSecret, {
    expiresIn: env.auth.jwtExpiresIn as SignOptions['expiresIn'],
  })
}

// Returns the payload, or null if the token is missing, expired or tampered with.
export function verifyToken(token: string | undefined): TokenPayload | null {
  if (!token) return null
  try {
    const decoded = jwt.verify(token, env.auth.jwtSecret)
    if (typeof decoded === 'string') return null
    const { sub, tv } = decoded as unknown as TokenPayload
    return typeof sub === 'number' && typeof tv === 'number' ? { sub, tv } : null
  } catch {
    return null
  }
}
