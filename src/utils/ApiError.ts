// Error with an HTTP status; thrown from services, formatted by the error middleware.
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  static badRequest(message = 'Bad request') {
    return new ApiError(400, message)
  }

  static unauthorized(message = 'Please log in to continue') {
    return new ApiError(401, message)
  }

  static conflict(message: string) {
    return new ApiError(409, message)
  }

  static notFound(message = 'Not found') {
    return new ApiError(404, message)
  }
}
