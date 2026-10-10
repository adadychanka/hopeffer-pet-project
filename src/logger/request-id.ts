import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

// What a load balancer or an upstream service sends: UUIDs, ULIDs, trace IDs.
// Anything else (spaces, quotes, line breaks, very long values) could forge
// log lines, so it is replaced.
const SAFE_ID = /^[\w.-]{1,128}$/;

// Reuses the caller's request ID so the app logs join with the load balancer
// logs, or creates a UUID. The ID goes back in the response header, so a user
// can report it.
export function requestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const id =
    typeof incoming === 'string' && SAFE_ID.test(incoming)
      ? incoming
      : randomUUID();
  res.setHeader('x-request-id', id);
  return id;
}
