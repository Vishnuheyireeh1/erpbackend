import { Router } from 'express'
import * as job from '../controllers/job.controller'
import { singleImage } from '../middlewares/upload.middleware'
import { validateBody } from '../middlewares/validate.middleware'
import { bookNoSchema } from '../validators/sales.validator'
import { jobAddItemsSchema, jobCostEntrySchema, jobWorkersSchema, jobCreateSchema, jobDeliverSchema, jobStatusSchema, jobUpdateSchema } from '../validators/job.validator'

// /api/jobs — stitching jobs
const router = Router()
router.get('/export', job.exportList)
router.get('/', job.list)
router.get('/:id', job.getOne)
router.get('/:id/pdf', job.pdf)
router.post('/', validateBody(jobCreateSchema), job.create)
router.put('/:id', validateBody(jobUpdateSchema), job.update)
router.post('/:id/status', validateBody(jobStatusSchema), job.setStatus)
router.post('/:id/deliver', validateBody(jobDeliverSchema), job.deliver)
router.post('/:id/cancel', job.cancel)
router.post('/:id/items', validateBody(jobAddItemsSchema), job.addItems)
router.delete('/:id/materials/:mid', job.removeItem)
router.post('/:id/costs', validateBody(jobCostEntrySchema), job.addCost)
router.put('/:id/costs/:eid', validateBody(jobCostEntrySchema), job.updateCost)
router.delete('/:id/costs/:eid', job.removeCost)
router.put('/:id/workers', validateBody(jobWorkersSchema), job.setWorkers)
router.put('/:id/book-no', validateBody(bookNoSchema), job.setBookNo)
router.post('/:id/items/:itemId/photo', singleImage, job.uploadPhoto)
router.delete('/:id/items/:itemId/photo', job.removePhoto)

export default router
