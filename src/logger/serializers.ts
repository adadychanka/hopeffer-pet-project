import type { StdSerializedResults } from 'pino-http';

const REDACTED = '[Redacted]';

// Allowlists: a header that is not listed is never logged, so a new secret
// header (an API key, a session cookie) cannot leak by accident. `referer` and
// `location` are left out because they hold URLs with query strings, and
// `x-request-id` because the accepted ID is already on the line as `reqId`,
// while the header holds whatever the caller sent.
const REQUEST_HEADERS = new Set([
  'host',
  'user-agent',
  'content-type',
  'content-length',
  'accept',
  'origin',
  'x-forwarded-for',
  'x-forwarded-proto',
  'traceparent',
]);
const RESPONSE_HEADERS = new Set([
  'content-type',
  'content-length',
  'cache-control',
  'etag',
  'retry-after',
]);

// Node lowercases header names, so the lookup needs no case folding.
function pick(
  headers: Record<string, unknown> | undefined,
  allowed: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).filter(([name]) => allowed.has(name)),
  );
}

// Keeps the path and the parameter names, hides every value: query strings
// carry tokens, emails and signed URL signatures.
export function maskQueryValues(url: string): string {
  const start = url.indexOf('?');
  if (start === -1) {
    return url;
  }
  const masked = url
    .slice(start + 1)
    .split('&')
    .map((pair) => {
      const equals = pair.indexOf('=');
      return equals === -1 ? pair : `${pair.slice(0, equals)}=${REDACTED}`;
    })
    .join('&');
  return `${url.slice(0, start)}?${masked}`;
}

// pino-http runs its own serializers first (wrapSerializers), so these get the
// plain objects, not the Node request and response. The parsed `query` and
// `params` are dropped: `url` already has them, with the values hidden.
export function serializeRequest(req: StdSerializedResults['req']) {
  return {
    id: req.id,
    method: req.method,
    url: maskQueryValues(req.url),
    headers: pick(req.headers, REQUEST_HEADERS),
    remoteAddress: req.remoteAddress,
    remotePort: req.remotePort,
  };
}

export function serializeResponse(res: StdSerializedResults['res']) {
  return {
    statusCode: res.statusCode,
    headers: pick(res.headers, RESPONSE_HEADERS),
  };
}
