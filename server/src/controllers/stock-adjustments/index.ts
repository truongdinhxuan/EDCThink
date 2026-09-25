import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CreateStockAdjustmentBody } from '../../interfaces/stock';
import { StockAdjustmentsService } from '../../services/stock-adjustments.service';
import { StockServiceError } from '../../services/stock.helpers';
import { stockActor } from '../stock-actor';
import { respondWithStockData } from '../stock-response';

export const createStockAdjustment = (
  request: FastifyRequest,
  reply: FastifyReply,
) => respondWithStockData(
  request,
  reply,
  () => {
    if (!request.user) throw new StockServiceError(401, 'Unauthorized');
    return new StockAdjustmentsService(request.server).create(
      stockActor(request),
      request.body as CreateStockAdjustmentBody,
    );
  },
  201,
);
