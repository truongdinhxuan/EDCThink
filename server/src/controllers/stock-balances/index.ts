import type { FastifyReply, FastifyRequest } from 'fastify';
import type { StockBalanceListQuery } from '../../interfaces/stock';
import { StockBalancesService } from '../../services/stock-balances.service';
import { stockActor } from '../stock-actor';
import { respondWithStockData } from '../stock-response';

export const listStockBalances = (request: FastifyRequest, reply: FastifyReply) =>
  respondWithStockData(request, reply, () =>
    new StockBalancesService(request.server, stockActor(request)).list(
      request.query as StockBalanceListQuery,
    ));

export const getStockBalance = (request: FastifyRequest, reply: FastifyReply) =>
  respondWithStockData(request, reply, () =>
    new StockBalancesService(request.server, stockActor(request)).get(
      (request.params as { id: string }).id,
    ));
