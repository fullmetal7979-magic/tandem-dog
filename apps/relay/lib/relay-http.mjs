// Shared HTTP/WebSocket request helpers for the relay: origin checks, caller
// identity, phone-leg capacity, and the trust-on-first-use upgrade authenticator.
import { isRoutingId } from './ids.mjs';

export const MAX_PHONE_CONNECTIONS_PER_MINUTE = 120;
export const PHONE_CONNECT_RATE_WINDOW_MS = 60_000;
export const MAX_PHONE_CLIENTS_PER_DEVICE = 32;

export function phoneClientCapacityAvailable(clientCount) {
  return Number(clientCount) < MAX_PHONE_CLIENTS_PER_DEVICE;
}

// Behind a TLS-terminating reverse proxy (the COSMOS Docker kit puts Caddy in
// front), the socket is plain and every peer is the proxy. TRUST_PROXY=1 reads
// the scheme and the caller from the proxy's X-Forwarded-* headers instead.
// Only safe when the relay port is reachable from the proxy alone.
let trustProxy = false;
export function configureProxyTrust(enabled) {
  trustProxy = Boolean(enabled);
}

function forwarded(request, name) {
  const value = request?.headers?.[name];
  return typeof value === 'string' ? value : '';
}

function requestProtocol(request) {
  if (trustProxy) {
    const proto = forwarded(request, 'x-forwarded-proto').split(',')[0].trim().toLowerCase();
    if (proto === 'https' || proto === 'http') return `${proto}:`;
  }
  return request?.socket?.encrypted ? 'https:' : 'http:';
}

export function browserSocketOriginAllowed(request) {
  const origin = typeof request?.headers?.origin === 'string' ? request.headers.origin : '';
  const host = typeof request?.headers?.host === 'string' ? request.headers.host : '';
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    const protocol = requestProtocol(request);
    return (
      parsed.protocol === protocol &&
      parsed.host.toLowerCase() === host.toLowerCase() &&
      parsed.pathname === '/' &&
      !parsed.search &&
      !parsed.hash &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

export function clientIp(request) {
  if (trustProxy) {
    // The proxy appends the peer it saw; the right-most entry is the one it vouches for.
    const hops = forwarded(request, 'x-forwarded-for')
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean);
    if (hops.length) return hops.at(-1);
  }
  return request.socket?.remoteAddress || 'unknown';
}

/** Whether a desktop leg entry exists and its socket is still open. */
export function desktopLegOpen(entry) {
  return Boolean(entry) && entry.socket.readyState === entry.socket.OPEN;
}

/** The request line as a URL, or null when it cannot be parsed. */
export function requestUrl(request) {
  try {
    return new URL(request.url || '/', 'http://localhost');
  } catch {
    return null;
  }
}

/** `{ url, pathname }` for the request line, or null when it cannot be parsed
 *  (malformed URL or percent-encoding). */
export function decodedRequestPath(request) {
  const url = requestUrl(request);
  if (!url) return null;
  try {
    return { url, pathname: decodeURIComponent(url.pathname) };
  } catch {
    return null;
  }
}

/** A status the desktop reported for an upstream answer, else 502. */
export function upstreamStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : 502;
}

export function endText(response, status, text, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers }).end(text);
}

/** Bounded probing: a caller past the unauthorized limiter is throttled (429)
 *  instead of buying unlimited token guesses and log noise; otherwise 401. */
export function rejectUnauthorizedText(unauthorizedLimiter, request, response) {
  if (!unauthorizedLimiter.allow(clientIp(request))) {
    endText(response, 429, 'Too many requests.', { 'Retry-After': '60' });
    return;
  }
  endText(response, 401, 'Unauthorized.');
}

export function authenticateLeg(store, registerLimiter, unauthorizedLimiter, request, deviceId, secret) {
  if (!isRoutingId(deviceId) || secret.length < 16) return 401;
  if (!store.isKnown(deviceId) && !registerLimiter.allow(clientIp(request))) return 429;
  if (store.authenticate(deviceId, secret)) return 0;
  return unauthorizedLimiter.allow(`auth:${clientIp(request)}`) ? 401 : 429;
}
