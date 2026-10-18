import type { NextFunction, Request, Response } from 'express'
import type { ZodType } from 'zod'
import { ApiError } from '../utils/ApiError'

// Validates req.body against a zod schema; replaces it with the cleaned data.
export function validateBody(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body ?? {})
    if (!result.success) {
      return next(ApiError.badRequest(result.error.issues[0]?.message ?? 'Invalid input'))
    }
    req.body = result.data
    next()
  }
}
