import AppError, { type AppErrorOptions } from './app.error';

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication is required.', options: AppErrorOptions = {}) {
    super(message, 401, { ...options, code: options.code ?? 'UNAUTHENTICATED' });
  }
}

export default AuthenticationError;
