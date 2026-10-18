import { Router } from 'express'
import * as s from '../controllers/system.controller'

// /api/system — backups, go-live checklist, activity log, bill printing (admin login required, like everything else).
const systemRoutes = Router()
systemRoutes.get('/backups', s.getBackups)
systemRoutes.post('/backups', s.backupNow)
systemRoutes.get('/backups/:name', s.downloadBackup)
systemRoutes.get('/checklist', s.getChecklist)
systemRoutes.get('/activity', s.getActivity)
systemRoutes.get('/activity/export', s.activityExport)
systemRoutes.get('/printers', s.getPrinters)
systemRoutes.post('/print', s.printText)

export default systemRoutes
