import type { Request, Response } from 'express'
import type { ZodType } from 'zod'
import * as ex from '../services/export/training.export'
import * as courses from '../services/training/course.service'
import * as fees from '../services/training/fee.service'
import * as students from '../services/training/student.service'
import { ApiError } from '../utils/ApiError'
import { cancelDocSchema } from '../validators/purchase.validator'
import {
  enrolSchema, enrolmentUpdateSchema, trainingListSchema,
  type BatchInput, type CourseInput, type FeeReceiptInput, type NewStudentInput, type StudentInput,
} from '../validators/training.validator'

function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data ?? {})
  if (!r.success) throw ApiError.badRequest(r.error.issues[0]?.message ?? 'Invalid input')
  return r.data
}
function readId(req: Request) {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('Invalid id')
  return id
}
const user = (req: Request) => req.admin!.username
const q = (req: Request) => parse(trainingListSchema, req.query)
const item = (res: Response, value: unknown, status = 200) => res.status(status).json({ success: true, item: value })
const done = (res: Response) => res.json({ success: true })

// /api/training/*
export const listCourses = async (_req: Request, res: Response) => res.json({ success: true, items: await courses.listCourses() })
export const createCourse = async (req: Request, res: Response) => item(res, await courses.saveCourse(null, req.body as CourseInput, user(req)), 201)
export const updateCourse = async (req: Request, res: Response) => item(res, await courses.saveCourse(readId(req), req.body as CourseInput, user(req)))
export async function removeCourse(req: Request, res: Response) {
  await courses.removeCourse(readId(req), user(req))
  done(res)
}

export const listBatches = async (req: Request, res: Response) => res.json({ success: true, items: await courses.listBatches(q(req)) })
export const createBatch = async (req: Request, res: Response) => item(res, await courses.saveBatch(null, req.body as BatchInput, user(req)), 201)
export const updateBatch = async (req: Request, res: Response) => item(res, await courses.saveBatch(readId(req), req.body as BatchInput, user(req)))
export async function removeBatch(req: Request, res: Response) {
  await courses.removeBatch(readId(req), user(req))
  done(res)
}

export const listStudents = async (req: Request, res: Response) => res.json({ success: true, ...(await students.listStudents(q(req))) })
export const exportStudents = (req: Request, res: Response) => ex.exportStudents(res, q(req), user(req))
export const getStudent = async (req: Request, res: Response) => item(res, await students.getStudent(readId(req)))
export const createStudent = async (req: Request, res: Response) => item(res, await students.createStudent(req.body as NewStudentInput, user(req)), 201)
export const updateStudent = async (req: Request, res: Response) => item(res, await students.updateStudent(readId(req), req.body as StudentInput, user(req)))
export async function removeStudent(req: Request, res: Response) {
  await students.removeStudent(readId(req), user(req))
  done(res)
}
export const enrol = async (req: Request, res: Response) => item(res, await students.enrol(readId(req), parse(enrolSchema, req.body), user(req)), 201)
export const updateEnrolment = async (req: Request, res: Response) => item(res, await students.updateEnrolment(readId(req), parse(enrolmentUpdateSchema, req.body), user(req)))

export const pendingFees = async (req: Request, res: Response) => res.json({ success: true, ...(await students.pendingFees(q(req))) })
export const exportPending = (req: Request, res: Response) => ex.exportPending(res, q(req), user(req))
export const listReceipts = async (req: Request, res: Response) => res.json({ success: true, ...(await fees.listReceipts(q(req))) })
export const exportReceipts = (req: Request, res: Response) => ex.exportReceipts(res, q(req), user(req))
export const getReceipt = async (req: Request, res: Response) => item(res, await fees.getReceipt(readId(req)))
export const createReceipt = async (req: Request, res: Response) => item(res, await fees.createReceipt(req.body as FeeReceiptInput, user(req)), 201)
export const cancelReceipt = async (req: Request, res: Response) => item(res, await fees.cancelReceipt(readId(req), parse(cancelDocSchema, req.body).reason, user(req)))
