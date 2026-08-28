import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../errors/app-error';
import { findClientByApiKey } from '../services/client-service';

declare module 'express-serve-static-core' {
  interface Request {
    clientId?: string;
  }
}

const getApiKey = (request: Request): string | undefined => {
  const headerValue = request.header('x-api-key');
  return headerValue?.trim() || undefined;
};

export const authenticate = async (
  request: Request,
  _response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const apiKey = getApiKey(request);

    if (!apiKey) {
      throw new AppError(401, 'UNAUTHENTICATED', 'An X-API-Key header is required.');
    }

    const client = await findClientByApiKey(apiKey);

    if (!client) {
      throw new AppError(401, 'UNAUTHENTICATED', 'The API key is invalid.');
    }

    request.clientId = client.id;
    next();
  } catch (error) {
    next(error);
  }
};
