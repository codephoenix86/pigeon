import { Router } from 'express';

import { authenticate } from '../auth/auth.middleware';
import {
  createSubscriptionController,
  deleteSubscriptionController,
  getSubscriptionController,
  listSubscriptionsController,
  updateSubscriptionController,
} from './subscription.controller';

export const subscriptionsRouter = Router();

subscriptionsRouter.use(authenticate);

subscriptionsRouter.post('/', createSubscriptionController);
subscriptionsRouter.get('/', listSubscriptionsController);
subscriptionsRouter.get('/:id', getSubscriptionController);
subscriptionsRouter.patch('/:id', updateSubscriptionController);
subscriptionsRouter.delete('/:id', deleteSubscriptionController);
