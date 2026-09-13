import { rateLimit } from 'express-rate-limit';

import { env } from '../config/env';

export const ingestionRateLimiter = rateLimit({
  windowMs: env.INGESTION_RATE_LIMIT_WINDOW_MS,
  limit: env.INGESTION_RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  identifier: 'event-ingestion',
  keyGenerator: (request) => request.clientId ?? 'unauthenticated',
  message: {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many event ingestion requests. Try again later.',
    },
  },
});
