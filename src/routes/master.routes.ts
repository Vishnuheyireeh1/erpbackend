import { Router } from 'express'
import * as exporter from '../controllers/export.controller'
import * as masterController from '../controllers/master.controller'

// /api/masters/categories | brands | units | sizes | colours | taxRates
const router = Router()

router.get('/:master', masterController.list)
router.get('/:master/options', masterController.options)
router.get('/:master/export', exporter.master)
router.post('/:master', masterController.create)
router.put('/:master/:id', masterController.update)
router.delete('/:master/:id', masterController.remove)

export default router
