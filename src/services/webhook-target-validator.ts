import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

import { AppError } from '../errors/app-error';

const blockedIpv4Addresses = new BlockList();
const blockedIpv6Addresses = new BlockList();

const blockedIpv4Subnets: Array<[string, number]> = [
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
];

const blockedIpv6Subnets: Array<[string, number]> = [
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
];

blockedIpv4Subnets.forEach(([network, prefix]) =>
  blockedIpv4Addresses.addSubnet(network, prefix, 'ipv4'),
);
blockedIpv6Subnets.forEach(([network, prefix]) =>
  blockedIpv6Addresses.addSubnet(network, prefix, 'ipv6'),
);

const invalidTargetUrl = (message: string) => new AppError(400, 'INVALID_TARGET_URL', message);

const normalizedHostname = (hostname: string): string =>
  hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
    .toLowerCase();

const isPublicAddress = (address: string): boolean => {
  const family = isIP(address);

  if (family === 4) {
    return !blockedIpv4Addresses.check(address, 'ipv4');
  }

  if (family === 6) {
    return !blockedIpv6Addresses.check(address, 'ipv6');
  }

  return false;
};

export const validateWebhookTargetUrl = async (targetUrl: string): Promise<string> => {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    throw invalidTargetUrl('Target URL must be a valid HTTPS URL.');
  }

  if (parsedUrl.protocol !== 'https:') {
    throw invalidTargetUrl('Target URL must use HTTPS.');
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw invalidTargetUrl('Target URL must not contain credentials.');
  }

  const hostname = normalizedHostname(parsedUrl.hostname);

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw invalidTargetUrl('Target URL must not use a local hostname.');
  }

  const literalAddressFamily = isIP(hostname);

  if (literalAddressFamily !== 0) {
    if (!isPublicAddress(hostname)) {
      throw invalidTargetUrl('Target URL must not use a private or reserved IP address.');
    }

    return parsedUrl.toString();
  }

  let resolvedAddresses: Array<{ address: string; family: number }>;

  try {
    resolvedAddresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw invalidTargetUrl('Target URL hostname could not be resolved.');
  }

  if (
    resolvedAddresses.length === 0 ||
    resolvedAddresses.some(({ address }) => !isPublicAddress(address))
  ) {
    throw invalidTargetUrl('Target URL hostname must resolve only to public IP addresses.');
  }

  return parsedUrl.toString();
};
