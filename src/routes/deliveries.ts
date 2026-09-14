import { Router } from 'express';
import { z } from 'zod';

import { authenticate } from '../middleware/authenticate';
import { listFailedDeliveries } from '../services/failed-delivery-service';

const listFailedDeliveriesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

const clientId = (request: { clientId?: string }): string => {
  if (!request.clientId) {
    throw new Error('Authenticated client ID is missing.');
  }

  return request.clientId;
};

export const deliveriesRouter = Router();

deliveriesRouter.use(authenticate);

deliveriesRouter.get('/failed', async (request, response) => {
  const query = listFailedDeliveriesQuerySchema.parse(request.query);
  const result = await listFailedDeliveries(clientId(request), query);

  response.status(200).json(result);
});
