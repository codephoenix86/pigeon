import { config as loadEnvironment } from 'dotenv';
import { z } from 'zod';

loadEnvironment();

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().trim().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z
    .string()
    .url()
    .default('postgresql://postgres@localhost:5432/pigeon?schema=public'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  DELIVERY_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(10_000),
  DELIVERY_MAX_ATTEMPTS: z.coerce.number().int().min(5).max(7).default(6),
  DELIVERY_BACKOFF_JITTER: z.coerce.number().min(0).max(0.5).default(0.2),
  DELIVERY_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(10),
  DELIVERY_SUBSCRIPTION_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(1),
  DELIVERY_THROTTLE_DELAY_MS: z.coerce.number().int().positive().max(60_000).default(1_000),
});

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  const issues = parsedEnvironment.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');

  throw new Error(`Invalid environment configuration: ${issues}`);
}

export const env = parsedEnvironment.data;
export type Environment = typeof env;
