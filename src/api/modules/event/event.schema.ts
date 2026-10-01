import { z } from 'zod';

export const eventIdParamsSchema = z.object({ id: z.string().uuid() });

export const eventTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'Must be a valid event type.');

export const createEventSchema = z
  .object({
    type: eventTypeSchema,
    payload: z.record(z.string(), z.unknown()),
    source: z.string().trim().min(1).max(255).optional(),
  })
  .strict();
