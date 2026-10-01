import { SubscriptionStatus } from '@prisma/client';
import { z } from 'zod';
import { eventTypeSchema } from '../event/event.schema';
export const subscriptionIdParamsSchema = z.object({ id: z.string().uuid() });

const eventTypesSchema = z
  .array(eventTypeSchema)
  .min(1)
  .max(100)
  .transform((types) => [...new Set(types)]);

export const createSubscriptionSchema = z
  .object({ targetUrl: z.string().url().max(2_048), eventTypes: eventTypesSchema })
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
