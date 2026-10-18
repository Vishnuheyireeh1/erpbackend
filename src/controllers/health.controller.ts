import type { Request, Response } from 'express'
import * as healthService from '../services/health.service'

export async function check(_req: Request, res: Response) {
  const health = await healthService.getHealth()
  res.status(health.database === 'connected' ? 200 : 503).json(health)
}
