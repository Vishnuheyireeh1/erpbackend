import { Router } from 'express'
import * as exporter from '../controllers/export.controller'
import * as productController from '../controllers/product.controller'
import * as importController from '../controllers/productImport.controller'
import { singleImage, singleSpreadsheet } from '../middlewares/upload.middleware'
import { validateBody } from '../middlewares/validate.middleware'
import { productSchema } from '../validators/product.validator'

// /api/products
const router = Router()

// Bulk import (before /:id so "import" is never read as an id)
router.get('/import/template', importController.template)
router.post('/import/validate', singleSpreadsheet, importController.validate)
router.post('/import', singleSpreadsheet, importController.commit)

router.get('/export', exporter.products)
router.get('/', productController.list)
router.get('/lookup', productController.lookup) // ?code=<barcode or SKU>
router.get('/:id', productController.getOne)
router.post('/', validateBody(productSchema), productController.create)
router.put('/:id', validateBody(productSchema), productController.update)
router.delete('/:id', productController.remove)
router.post('/:id/image', singleImage, productController.uploadImage)
router.delete('/:id/image', productController.removeImage)

export default router
