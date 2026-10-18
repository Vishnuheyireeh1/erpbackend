import type { NextFunction, Request, Response } from 'express'
import multer from 'multer'
import { ApiError } from '../utils/ApiError'

const MB = 1024 * 1024

// Files are kept in memory so services can check the real content before anything is saved.
function singleFile(field: string, maxBytes: number, tooBig: string) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 5 },
  }).single(field)

  return (req: Request, res: Response, next: NextFunction) => {
    upload(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        return next(ApiError.badRequest(err.code === 'LIMIT_FILE_SIZE' ? tooBig : 'Upload one file only'))
      }
      next(err)
    })
  }
}

// Product photo: 2 MB.
export const singleImage = singleFile('image', 2 * MB, 'Image must be 2 MB or smaller')

// Product import sheet: 25 MB (about 2 lakh rows).
export const singleSpreadsheet = singleFile('file', 25 * MB, 'File must be 25 MB or smaller — split it into parts')
