export interface AppErrorOptions {
  /** Machine-readable error code, e.g. "USER_NOT_FOUND" */
  code?: string;
  /** Extra data, e.g. validation errors */
  details?: unknown;
  /** Expected error (true) vs. programmer bug (false) */
  isOperational?: boolean;
  /** Original error, preserved for logging */
  cause?: unknown;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly status: 'fail' | 'error';
  public readonly code?: string;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });

    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.status = statusCode >= 400 && statusCode < 500 ? 'fail' : 'error';
    this.code = options.code;
    this.details = options.details;
    this.isOperational = options.isOperational ?? true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export default AppError;
