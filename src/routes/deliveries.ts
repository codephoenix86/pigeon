import { Router } from 'express';

import { authenticate } from '../middleware/authenticate';
import { listFailedDeliveries } from '../services/failed-delivery-service';
import { listFailedDeliveriesQuerySchema } from '../validation/request-schemas';

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
