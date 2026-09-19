import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  getCachedAuthenticatedClientId: vi.fn(),
  isKnownInvalidApiKey: vi.fn(),
  cacheAuthenticatedClient: vi.fn(),
  cacheInvalidApiKey: vi.fn(),
}));

vi.mock('../../src/db', () => ({
  prisma: {
    client: {
      findUnique: mocks.findUnique,
    },
  },
}));

vi.mock('../../src/services/api-key-cache-service', () => ({
  getCachedAuthenticatedClientId: mocks.getCachedAuthenticatedClientId,
  isKnownInvalidApiKey: mocks.isKnownInvalidApiKey,
  cacheAuthenticatedClient: mocks.cacheAuthenticatedClient,
  cacheInvalidApiKey: mocks.cacheInvalidApiKey,
}));

import { findClientByApiKey, hashApiKey } from '../../src/services/client-service';

const API_KEY = `pgn_${'a'.repeat(43)}`;
const API_KEY_HASH = hashApiKey(API_KEY);
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';

describe('client service API-key cache', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getCachedAuthenticatedClientId.mockResolvedValue(null);
    mocks.isKnownInvalidApiKey.mockResolvedValue(false);
    mocks.cacheAuthenticatedClient.mockResolvedValue(undefined);
    mocks.cacheInvalidApiKey.mockResolvedValue(undefined);
  });

  it('returns a cached client without querying PostgreSQL', async () => {
    mocks.getCachedAuthenticatedClientId.mockResolvedValue(CLIENT_ID);

    await expect(findClientByApiKey(API_KEY)).resolves.toEqual({ id: CLIENT_ID });

    expect(mocks.getCachedAuthenticatedClientId).toHaveBeenCalledWith(API_KEY_HASH);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('loads a cache miss from PostgreSQL and caches the client ID', async () => {
    mocks.findUnique.mockResolvedValue({ id: CLIENT_ID });

    await expect(findClientByApiKey(API_KEY)).resolves.toEqual({ id: CLIENT_ID });

    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { apiKeyHash: API_KEY_HASH },
      select: { id: true },
    });
    expect(mocks.cacheAuthenticatedClient).toHaveBeenCalledWith(API_KEY_HASH, CLIENT_ID);
  });

  it('rejects a negative-cache hit without querying PostgreSQL', async () => {
    mocks.isKnownInvalidApiKey.mockResolvedValue(true);

    await expect(findClientByApiKey(API_KEY)).resolves.toBeNull();

    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('negative-caches only API keys with Pigeon’s expected format', async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(findClientByApiKey(API_KEY)).resolves.toBeNull();
    expect(mocks.cacheInvalidApiKey).toHaveBeenCalledWith(API_KEY_HASH);

    await expect(findClientByApiKey('invalid')).resolves.toBeNull();
    expect(mocks.cacheInvalidApiKey).toHaveBeenCalledTimes(1);
  });
});
