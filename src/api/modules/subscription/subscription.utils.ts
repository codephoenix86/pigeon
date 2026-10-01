import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { AppError } from '../../common/errors';

const allowLocalTargets = process.env.ALLOW_LOCAL_WEBHOOK_TARGETS === 'true';
const invalidUrlError = (msg: string) => new AppError(msg, 400, { code: 'INVALID_TARGET_URL' });

const buildBlockList = (type: 'ipv4' | 'ipv6', subnets: [string, number][]) => {
  const list = new BlockList();
  subnets.forEach(([ip, prefix]) => list.addSubnet(ip, prefix, type));
  return list;
};

const blockedIpv4 = buildBlockList('ipv4', [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]);

const blockedIpv6 = buildBlockList('ipv6', [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001:db8::', 32],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
]);

const isPublicAddress = (ip: string): boolean => {
  const family = isIP(ip);
  if (family === 4) return !blockedIpv4.check(ip, 'ipv4');
  if (family === 6) return !blockedIpv6.check(ip, 'ipv6');
  return false;
};

export const validateWebhookTargetUrl = async (url: string): Promise<string> => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw invalidUrlError('Target URL must be a valid HTTPS URL.');
  }

  if (!allowLocalTargets && parsed.protocol !== 'https:')
    throw invalidUrlError('Target URL must use HTTPS.');
  if (parsed.username || parsed.password)
    throw invalidUrlError('Target URL must not contain credentials.');

  const hostname = parsed.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
    .toLowerCase();

  if (!allowLocalTargets && (hostname === 'localhost' || hostname.endsWith('.localhost'))) {
    throw invalidUrlError('Target URL must not use a local hostname.');
  }

  if (isIP(hostname)) {
    if (!allowLocalTargets && !isPublicAddress(hostname)) {
      throw invalidUrlError('Target URL must not use a private or reserved IP address.');
    }
    return parsed.toString();
  }

  try {
    const resolved = await lookup(hostname, { all: true, verbatim: true });
    if (
      resolved.length === 0 ||
      (!allowLocalTargets && resolved.some(({ address }) => !isPublicAddress(address)))
    ) {
      throw invalidUrlError('Target URL hostname must resolve only to public IP addresses.');
    }
  } catch {
    throw invalidUrlError('Target URL hostname could not be resolved.');
  }

  return parsed.toString();
};
