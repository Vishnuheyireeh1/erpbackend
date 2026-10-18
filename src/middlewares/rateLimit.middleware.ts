import rateLimit from 'express-rate-limit'

// 5 failed logins per 15 minutes per IP; successful logins don't count.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many failed attempts. Try again in 15 minutes.',
  },
})
