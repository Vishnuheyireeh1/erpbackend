import type { NextFunction, Request, Response } from 'express'
import { ApiError } from '../utils/ApiError'

// 404 for any unmatched /api route.
export function notFound(req: Request, _res: Response, next: NextFunction) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`))
}

// Database errors that services didn't catch first → friendly messages.
const prismaErrors: Record<string, [number, string]> = {
  P2002: [409, 'This record already exists'],
  P2003: [409, "This record is still used elsewhere, so it can't be changed or deleted"],
  P2025: [404, 'Record not found'],
}

function toApiError(err: Error): ApiError | null {
  if (err instanceof ApiError) return err
  const code = (err as { code?: unknown }).code
  if (typeof code === 'string' && prismaErrors[code]) {
    const [status, message] = prismaErrors[code]
    return new ApiError(status, message)
  }
  // Malformed JSON body from express.json()
  if ((err as { type?: string }).type === 'entity.parse.failed') {
    return ApiError.badRequest('Request body is not valid JSON')
  }
  return null
}

// Single place where every error becomes a JSON response.
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  const apiError = toApiError(err)
  if (!apiError) console.error('[error]', err)
  res.status(apiError?.statusCode ?? 500).json({
    success: false,
    message: apiError?.message ?? 'Something went wrong',
  })
}
