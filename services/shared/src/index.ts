/**
 * Domain error with a stable code. The `code` is the API contract; `message`
 * may change. Each service maps it to HTTP in its `api/` layer.
 */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
