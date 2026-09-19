import { createHash, randomBytes } from 'node:crypto';

import { env } from '../config/env';
import { prisma } from '../db';
import {
  cacheAuthenticatedClient,
  cacheInvalidApiKey,
  getCachedAuthenticatedClientId,
  isKnownInvalidApiKey,
} from './api-key-cache-service';

const API_KEY_PREFIX = 'pgn_';

export const hashApiKey = (apiKey: string): string =>
  createHash('sha256').update(apiKey).digest('hex');

/**
 * Provisions a client for an operator-controlled setup flow. The raw API key is
 * returned only from this function; only its SHA-256 digest is stored in PostgreSQL.
 */
export const createClient = async () => {
  const apiKey = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  const client = await prisma.client.create({
    data: { apiKeyHash: hashApiKey(apiKey) },
    select: { id: true, createdAt: true },
  });

  return { client, apiKey };
};

export const findClientByApiKey = (apiKey: string) =>
  findClientByApiKeyHash(hashApiKey(apiKey), isCacheableApiKey(apiKey));

const isCacheableApiKey = (apiKey: string): boolean => /^pgn_[A-Za-z0-9_-]{43}$/.test(apiKey);

const findClientByApiKeyHash = async (apiKeyHash: string, cacheNegativeResult: boolean) => {
  if (env.API_KEY_CACHE_ENABLED) {
    const cachedClientId = await getCachedAuthenticatedClientId(apiKeyHash);

    if (cachedClientId) {
      return { id: cachedClientId };
    }

    if (await isKnownInvalidApiKey(apiKeyHash)) {
      return null;
    }
  }

  const client = await prisma.client.findUnique({
    where: { apiKeyHash },
    select: { id: true },
  });

  if (client && env.API_KEY_CACHE_ENABLED) {
    await cacheAuthenticatedClient(apiKeyHash, client.id);
  } else if (!client && cacheNegativeResult && env.API_KEY_CACHE_ENABLED) {
    await cacheInvalidApiKey(apiKeyHash);
  }

  return client;
};
