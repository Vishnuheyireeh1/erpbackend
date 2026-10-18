// Adds the logged-in admin to Express's Request (set by requireAuth).
declare global {
  namespace Express {
    interface Request {
      admin?: { id: number; username: string }
    }
  }
}

export {}
