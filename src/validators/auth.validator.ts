import { z } from 'zod'

export const loginSchema = z.object({
  username: z.string({ error: 'Enter your username' }).trim().min(1, 'Enter your username').max(50),
  password: z.string({ error: 'Enter your password' }).min(1, 'Enter your password').max(200),
})

export const changePasswordSchema = z.object({
  currentPassword: z
    .string({ error: 'Enter your current password' })
    .min(1, 'Enter your current password'),
  newPassword: z
    .string({ error: 'Enter a new password' })
    .min(8, 'New password must be at least 8 characters')
    .max(200, 'New password is too long'),
})

export type LoginInput = z.infer<typeof loginSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
