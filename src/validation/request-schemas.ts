import { SubscriptionStatus } from '@prisma/client';
import { z } from 'zod';

export const idParamsSchema = z.object({ id: z.string().uuid() });

export const eventTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'Must be a valid event type.');

const eventTypesSchema = z
  .array(eventTypeSchema)
  .min(1)
  .max(100)
  .transform((types) => [...new Set(types)]);

export const createSubscriptionSchema = z
  .object({
    targetUrl: z.string().url().max(2_048),
    eventTypes: eventTypesSchema,
  })
  .strict();

export const updateSubscriptionSchema = z
  .object({
    targetUrl: z.string().url().max(2_048).optional(),
    eventTypes: eventTypesSchema.optional(),
    status: z.nativeEnum(SubscriptionStatus).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'At least one field is required.');

export const listSubscriptionsQuerySchema = z
  .object({ status: z.nativeEnum(SubscriptionStatus).optional() })
  .strict();

export const createEventSchema = z
  .object({
    type: eventTypeSchema,
    payload: z.record(z.string(), z.unknown()),
    source: z.string().trim().min(1).max(255).optional(),
  })
  .strict();

export const listFailedDeliveriesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();
