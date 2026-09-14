import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

import { validateWebhookTargetUrl } from '../../src/services/webhook-target-validator';

const expectInvalidTarget = async (targetUrl: string) => {
  await expect(validateWebhookTargetUrl(targetUrl)).rejects.toMatchObject({
    statusCode: 400,
    code: 'INVALID_TARGET_URL',
  });
};

describe('validateWebhookTargetUrl', () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it.each(['not-a-url', 'http://example.com/hook', 'ftp://example.com/hook'])(
    'rejects a malformed or non-HTTPS URL: %s',
    async (targetUrl) => {
      await expectInvalidTarget(targetUrl);
    },
  );

  it('rejects embedded credentials', async () => {
    await expectInvalidTarget('https://user:password@example.com/hook');
  });

  it.each([
    'https://localhost/hook',
    'https://service.localhost/hook',
    'https://127.0.0.1/hook',
    'https://10.20.30.40/hook',
    'https://[::1]/hook',
    'https://[fc00::1]/hook',
  ])('rejects a local or private target: %s', async (targetUrl) => {
    await expectInvalidTarget(targetUrl);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('accepts a public IP address without a DNS lookup', async () => {
    await expect(validateWebhookTargetUrl('https://8.8.8.8/hook')).resolves.toBe(
      'https://8.8.8.8/hook',
    );
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('accepts a hostname when every resolved address is public', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);

    await expect(validateWebhookTargetUrl('https://Example.COM./hook')).resolves.toBe(
      'https://example.com./hook',
    );
    expect(lookupMock).toHaveBeenCalledWith('example.com', { all: true, verbatim: true });
  });

  it('rejects a hostname when any resolved address is private', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '192.168.1.10', family: 4 },
    ]);

    await expectInvalidTarget('https://example.com/hook');
  });

  it('rejects a hostname with no resolved addresses', async () => {
    lookupMock.mockResolvedValue([]);

    await expectInvalidTarget('https://example.com/hook');
  });

  it('rejects an invalid address returned by DNS', async () => {
    lookupMock.mockResolvedValue([{ address: 'not-an-ip-address', family: 0 }]);

    await expectInvalidTarget('https://example.com/hook');
  });

  it('rejects a hostname when DNS resolution fails', async () => {
    lookupMock.mockRejectedValue(new Error('DNS lookup failed'));

    await expectInvalidTarget('https://example.com/hook');
  });
});
