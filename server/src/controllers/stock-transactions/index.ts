import type { FastifyReply, FastifyRequest } from 'fastify';
import type { StockTransactionListQuery } from '../../interfaces/stock';
import { StockTransactionsService } from '../../services/stock-transactions.service';
import { stockActor } from '../stock-actor';
import { respondWithStockData } from '../stock-response';

export const listStockTransactions = (
  request: FastifyRequest,
  reply: FastifyReply,
) => respondWithStockData(request, reply, () =>
  new StockTransactionsService(request.server, stockActor(request)).list(
    request.query as StockTransactionListQuery,
  ));

export const getStockTransaction = (
  request: FastifyRequest,
  reply: FastifyReply,
) => respondWithStockData(request, reply, () =>
  new StockTransactionsService(request.server, stockActor(request)).get(
    (request.params as { id: string }).id,
  ));
