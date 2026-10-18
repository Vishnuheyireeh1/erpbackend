import { Router } from 'express'
import * as t from '../controllers/training.controller'
import { validateBody } from '../middlewares/validate.middleware'
import { batchSchema, courseSchema, feeReceiptSchema, newStudentSchema, studentSchema } from '../validators/training.validator'

// /api/training — courses, batches, students, enrolments, fees
const trainingRoutes = Router()
trainingRoutes.get('/courses', t.listCourses)
trainingRoutes.post('/courses', validateBody(courseSchema), t.createCourse)
trainingRoutes.put('/courses/:id', validateBody(courseSchema), t.updateCourse)
trainingRoutes.delete('/courses/:id', t.removeCourse)

trainingRoutes.get('/batches', t.listBatches)
trainingRoutes.post('/batches', validateBody(batchSchema), t.createBatch)
trainingRoutes.put('/batches/:id', validateBody(batchSchema), t.updateBatch)
trainingRoutes.delete('/batches/:id', t.removeBatch)

trainingRoutes.get('/students/export', t.exportStudents)
trainingRoutes.get('/students', t.listStudents)
trainingRoutes.get('/students/:id', t.getStudent)
trainingRoutes.post('/students', validateBody(newStudentSchema), t.createStudent)
trainingRoutes.put('/students/:id', validateBody(studentSchema), t.updateStudent)
trainingRoutes.delete('/students/:id', t.removeStudent)
trainingRoutes.post('/students/:id/enrol', t.enrol)
trainingRoutes.put('/enrolments/:id', t.updateEnrolment)

trainingRoutes.get('/fees/pending', t.pendingFees)
trainingRoutes.get('/fees/pending/export', t.exportPending)
trainingRoutes.get('/fees/export', t.exportReceipts)
trainingRoutes.get('/fees', t.listReceipts)
trainingRoutes.get('/fees/:id', t.getReceipt)
trainingRoutes.post('/fees', validateBody(feeReceiptSchema), t.createReceipt)
trainingRoutes.post('/fees/:id/cancel', t.cancelReceipt)

export default trainingRoutes
