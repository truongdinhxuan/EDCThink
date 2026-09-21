import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  InventoryDiscrepancyListQuery,
  ResolveInventoryDiscrepancyBody,
} from '../../interfaces/stock';
import { InventoryDiscrepanciesService } from '../../services/inventory-discrepancies.service';
import { stockActor } from '../stock-actor';
import { respondWithStockData } from '../stock-response';

export const listStockBalanceDiscrepancies = (
  request: FastifyRequest,
  reply: FastifyReply,
) => respondWithStockData(request, reply, () =>
  new InventoryDiscrepanciesService(request.server, stockActor(request)).listForBalance(
    (request.params as { id: string }).id,
    request.query as InventoryDiscrepancyListQuery,
  ));

export const resolveInventoryDiscrepancy = (
  request: FastifyRequest,
  reply: FastifyReply,
) => respondWithStockData(request, reply, () =>
  new InventoryDiscrepanciesService(request.server, stockActor(request)).resolve(
    (request.params as { id: string }).id,
    request.user.id,
    request.body as ResolveInventoryDiscrepancyBody,
  ));
