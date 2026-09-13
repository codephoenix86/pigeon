import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';
import pinoHttp from 'pino-http';

import { logger, runWithLogger } from '../config/logger';

const REQUEST_ID_HEADER = 'x-request-id';
const MAX_REQUEST_ID_LENGTH = 128;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

const suppliedRequestId = (header: string | string[] | undefined): string | undefined => {
  const value = Array.isArray(header) ? header[0] : header;

  if (!value || value.length > MAX_REQUEST_ID_LENGTH || !REQUEST_ID_PATTERN.test(value)) {
    return undefined;
  }

  return value;
};

export const httpLogger = pinoHttp({
  logger,
  genReqId: (request, response) => {
    const correlationId = suppliedRequestId(request.headers[REQUEST_ID_HEADER]) ?? randomUUID();
    response.setHeader('X-Request-Id', correlationId);
    return correlationId;
  },
  customProps: (request) => ({ correlationId: request.id }),
  customAttributeKeys: {
    req: 'request',
    res: 'response',
    reqId: 'correlationId',
    responseTime: 'responseTimeMs',
  },
  customLogLevel: (_request, response, error) => {
    if (error || response.statusCode >= 500) {
      return 'error';
    }

    if (response.statusCode >= 400) {
      return 'warn';
    }

    return 'info';
  },
  customSuccessMessage: () => 'HTTP request completed',
  customErrorMessage: () => 'HTTP request failed',
  wrapSerializers: false,
  serializers: {
    request: (request) => ({
      method: request.method,
      url: request.url,
      remoteAddress: request.socket.remoteAddress,
    }),
    response: (response) => ({ statusCode: response.statusCode }),
  },
});

export const bindRequestLogger: RequestHandler = (request, _response, next) => {
  runWithLogger(request.log, next);
};
