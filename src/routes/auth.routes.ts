import { Router } from 'express'
import * as authController from '../controllers/auth.controller'
import { requireAuth } from '../middlewares/auth.middleware'
import { loginLimiter } from '../middlewares/rateLimit.middleware'
import { validateBody } from '../middlewares/validate.middleware'
import { changePasswordSchema, loginSchema } from '../validators/auth.validator'

const router = Router()

router.post('/login', loginLimiter, validateBody(loginSchema), authController.login)
router.post('/logout', authController.logout)
router.get('/me', requireAuth, authController.me)
router.put('/password', requireAuth, validateBody(changePasswordSchema), authController.changePassword)

export default router
