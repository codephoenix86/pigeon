import { Router } from 'express';

import { authenticate } from '../auth/auth.middleware';
import { listFailedDeliveriesController } from './delivery.controller';

export const deliveriesRouter = Router();
deliveriesRouter.use(authenticate);
deliveriesRouter.get('/failed', listFailedDeliveriesController);
