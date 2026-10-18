import type { Request, Response } from 'express'
import * as importService from '../services/productImport.service'

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// "createMissing" comes as a multipart text field: "true" / "false".
const createMissing = (req: Request) => req.body?.createMissing === 'true'

export async function template(_req: Request, res: Response) {
  const buf = await importService.buildTemplate()
  res.setHeader('Content-Type', XLSX_TYPE)
  res.setHeader('Content-Disposition', 'attachment; filename="sairandhri-product-import.xlsx"')
  res.send(buf)
}

export async function validate(req: Request, res: Response) {
  res.json({ success: true, ...(await importService.validateFile(req.file, createMissing(req))) })
}

export async function commit(req: Request, res: Response) {
  const result = await importService.importFile(req.file, createMissing(req), req.admin!.username)
  res.status(result.imported ? 201 : 422).json({ success: result.imported, ...result })
}
