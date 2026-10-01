import type { NextFunction, Request, Response } from 'express';
import { AuthenticationError } from '../../common/errors';
import { findClientByApiKey } from '../client/client.service';

declare module 'express-serve-static-core' {
  interface Request {
    clientId?: string;
  }
}

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.header('x-api-key')?.trim();

  if (!apiKey) throw new AuthenticationError('An X-API-Key header is required.');

  const client = await findClientByApiKey(apiKey);

  if (!client) throw new AuthenticationError('The API key is invalid.');

  req.clientId = client.id;
  next();
};
