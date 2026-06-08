import dns from 'dns/promises';
import { URL } from 'url';

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
]);

const PRIVATE_IP_RANGES: Array<{ min: number; max: number }> = [
  // 127.0.0.0/8 — loopback
  { min: ipToNum('127.0.0.0'), max: ipToNum('127.255.255.255') },
  // 10.0.0.0/8 — class A private
  { min: ipToNum('10.0.0.0'), max: ipToNum('10.255.255.255') },
  // 172.16.0.0/12 — class B private
  { min: ipToNum('172.16.0.0'), max: ipToNum('172.31.255.255') },
  // 192.168.0.0/16 — class C private
  { min: ipToNum('192.168.0.0'), max: ipToNum('192.168.255.255') },
  // 169.254.0.0/16 — link-local
  { min: ipToNum('169.254.0.0'), max: ipToNum('169.254.255.255') },
  // 0.0.0.0 — unspecified
  { min: ipToNum('0.0.0.0'), max: ipToNum('0.0.0.0') },
];

function ipToNum(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIP(ip: string): boolean {
  const num = ipToNum(ip);
  return PRIVATE_IP_RANGES.some((range) => num >= range.min && num <= range.max);
}

// Exported for SSRF protection in HTTP lookup callbacks (web-fetch.ts)
export { isPrivateIP };

export interface UrlValidationResult {
  allowed: boolean;
  reason?: string;
  resolvedIP?: string;
}

/**
 * Validates a URL for safe fetching:
 * - Only http/https protocols
 * - No blocked hostnames (localhost, etc.)
 * - DNS resolve → IP check (SSRF protection)
 * - No private/internal IP ranges
 */
export async function validateUrlForFetch(rawUrl: string): Promise<UrlValidationResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: 'Invalid URL format' };
  }

  // Protocol check
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { allowed: false, reason: `Blocked protocol: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Blocked hostnames
  if (BLOCKED_HOSTS.has(hostname)) {
    return { allowed: false, reason: `Blocked hostname: ${hostname}` };
  }

  // IP literal check (before DNS)
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    if (isPrivateIP(hostname)) {
      return { allowed: false, reason: `Blocked private IP: ${hostname}` };
    }
  }

  // DNS resolve → IP check (prevents DNS rebinding / TOCTOU)
  try {
    const addresses = await dns.resolve4(hostname);
    if (addresses.length === 0) {
      return { allowed: false, reason: `DNS resolved no addresses for: ${hostname}` };
    }
    const resolvedIP = addresses[0];
    if (isPrivateIP(resolvedIP)) {
      return { allowed: false, reason: `Blocked: ${hostname} resolves to private IP ${resolvedIP}` };
    }
    return { allowed: true, resolvedIP };
  } catch {
    return { allowed: false, reason: `DNS resolution failed for: ${hostname}` };
  }
}

/**
 * Validates every URL in a redirect chain.
 * Returns the first blocked result, or { allowed: true } if all pass.
 */
export async function validateRedirectChain(urls: string[]): Promise<UrlValidationResult> {
  for (const url of urls) {
    const result = await validateUrlForFetch(url);
    if (!result.allowed) return result;
  }
  return { allowed: true };
}
