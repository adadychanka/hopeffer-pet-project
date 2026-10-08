import { z } from 'zod';

// Every setting the app reads. ConfigModule validates process.env (merged with
// .env, when the file exists) against this schema at startup, so a missing or
// malformed value stops the app with a clear error instead of connecting to the
// wrong place. Connection settings have no defaults on purpose: .env.example
// holds the local values.
const settings = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),

  // Leave S3_ENDPOINT unset for AWS S3. Leave both keys unset to let the AWS
  // SDK find credentials itself (IRSA, workload identity, instance role).
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1).optional(),
  S3_SECRET_KEY: z.string().min(1).optional(),

  OPENSEARCH_NODE: z.url(),
  OPENSEARCH_USERNAME: z.string().min(1).optional(),
  OPENSEARCH_PASSWORD: z.string().min(1).optional(),
  // PEM text of the CA that signed the cluster certificate, when a public CA
  // did not. A Kubernetes secret can supply it as an env var.
  OPENSEARCH_CA_CERT: z.string().min(1).optional(),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .optional(),
  LOG_FILE: z.string().min(1).optional(),
});

// Half a credential pair is a mistake, not a request for the default.
function bothOrNeither(a: unknown, b: unknown): boolean {
  return (a === undefined) === (b === undefined);
}

function pairError(a: string, b: string) {
  return {
    message: `Set ${a} and ${b} together, or leave both unset`,
    path: [a],
  };
}

export const envSchema = settings
  .refine(
    (env) => bothOrNeither(env.S3_ACCESS_KEY, env.S3_SECRET_KEY),
    pairError('S3_ACCESS_KEY', 'S3_SECRET_KEY'),
  )
  .refine(
    (env) => bothOrNeither(env.OPENSEARCH_USERNAME, env.OPENSEARCH_PASSWORD),
    pairError('OPENSEARCH_USERNAME', 'OPENSEARCH_PASSWORD'),
  );

// The TypeORM CLI runs outside Nest and needs only the database.
export const migrationEnvSchema = settings.pick({ DATABASE_URL: true });

export type Env = z.infer<typeof envSchema>;

function parse<T extends z.ZodType>(
  schema: T,
  config: Record<string, unknown>,
): z.infer<T> {
  const result = schema.safeParse(config);
  if (!result.success) {
    throw new Error(
      `Invalid environment variables:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

export function validateEnv(config: Record<string, unknown>): Env {
  return parse(envSchema, config);
}

export function validateMigrationEnv(
  config: Record<string, unknown>,
): z.infer<typeof migrationEnvSchema> {
  return parse(migrationEnvSchema, config);
}
