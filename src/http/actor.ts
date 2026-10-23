import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { DomainError } from './domain-error.js';
import { parseInput } from './zod-validation.pipe.js';

// Who acts, stated by the caller in three headers until the security feature
// replaces them with a verified session (feature 003 research R5). The
// headers are trusted as sent: the API must stay inside a trusted network.
export type ActorRole = 'operator' | 'company';

export type Actor =
  | { role: 'operator'; ref: string }
  | { role: 'company'; ref: string; companyId: string };

const actorRef = z.string().min(1).max(200);

const actorHeaders = z.discriminatedUnion('x-actor-role', [
  z.object({
    'x-actor-role': z.literal('operator'),
    'x-actor-ref': actorRef,
    'x-company-id': z
      .undefined({ error: 'An operator does not act for a company' })
      .optional(),
  }),
  z.object({
    'x-actor-role': z.literal('company'),
    'x-actor-ref': actorRef,
    'x-company-id': z.uuid(),
  }),
]);

export function parseActor(
  headers: Record<string, unknown>,
  allowedRoles: readonly ActorRole[],
): Actor {
  const parsed = parseInput(actorHeaders, headers, 'headers');
  const actor: Actor =
    parsed['x-actor-role'] === 'operator'
      ? { role: 'operator', ref: parsed['x-actor-ref'] }
      : {
          role: 'company',
          ref: parsed['x-actor-ref'],
          companyId: parsed['x-company-id'],
        };
  if (!allowedRoles.includes(actor.role)) {
    throw new DomainError(
      'forbidden_role',
      `This operation accepts the roles: ${allowedRoles.join(', ')}.`,
    );
  }
  return actor;
}

// @ActorContext('company') injects the Actor of the request, or rejects it.
export const ActorContext = createParamDecorator(
  (allowedRoles: readonly ActorRole[], context: ExecutionContext): Actor =>
    parseActor(
      context.switchToHttp().getRequest<Request>().headers,
      allowedRoles,
    ),
);
