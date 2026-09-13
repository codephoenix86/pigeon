import { AsyncLocalStorage } from 'node:async_hooks';

import pino, { Logger } from 'pino';

import { env } from './env';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: 'pigeon',
    environment: env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: pino.stdSerializers.err,
  },
  redact: {
    paths: [
      'apiKey',
      'secret',
      'req.headers.authorization',
      'req.headers.x-api-key',
      'request.headers.authorization',
      'request.headers.x-api-key',
    ],
    censor: '[REDACTED]',
  },
});

const requestLoggerStorage = new AsyncLocalStorage<Logger>();

export const runWithLogger = <T>(requestLogger: Logger, callback: () => T): T =>
  requestLoggerStorage.run(requestLogger, callback);

/**
 * Returns the request-scoped logger when called from an HTTP request and the
 * application logger everywhere else (workers, timers, and startup code).
 */
export const getLogger = (): Logger => requestLoggerStorage.getStore() ?? logger;
