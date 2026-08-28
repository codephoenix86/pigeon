import { createHash, randomBytes } from 'node:crypto';

import { prisma } from '../db';

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
  prisma.client.findUnique({
    where: { apiKeyHash: hashApiKey(apiKey) },
    select: { id: true },
  });
