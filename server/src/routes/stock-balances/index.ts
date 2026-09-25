import type { FastifyPluginAsync } from 'fastify';
import {
  getStockBalance,
  listStockBalances,
  replaceStockBalanceLocations,
} from '../../controllers/stock-balances';
import { PERMISSION_CODE } from '../../domain/permission-codes';
import { requirePermission, verifyToken } from '../../middleware/auth';
import {
  stockBalanceListSchema,
  stockBalanceLocationsReplaceSchema,
  stockIdParamsSchema,
  inventoryDiscrepancyListSchema,
} from '../../schemas/stock';
import { listStockBalanceDiscrepancies } from '../../controllers/inventory-discrepancies';

const stockBalanceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/',
    {
      preHandler: [verifyToken, requirePermission(PERMISSION_CODE.SUPPLY_STOCK_READ)],
      schema: stockBalanceListSchema,
    },
    listStockBalances,
  );
  fastify.get(
    '/:id',
    {
      preHandler: [verifyToken, requirePermission(PERMISSION_CODE.SUPPLY_STOCK_READ)],
      schema: stockIdParamsSchema,
    },
    getStockBalance,
  );
  // Relabelling is a stock edit: same permission as an adjustment, and the
  // service pins it to the actor's writable Area.
  fastify.put(
    '/:id/locations',
    {
      preHandler: [verifyToken, requirePermission(PERMISSION_CODE.SUPPLY_STOCK_ADJUST)],
      schema: stockBalanceLocationsReplaceSchema,
    },
    replaceStockBalanceLocations,
  );
  fastify.get(
    '/:id/discrepancies',
    {
      preHandler: [verifyToken, requirePermission(PERMISSION_CODE.SUPPLY_STOCK_READ)],
      schema: inventoryDiscrepancyListSchema,
    },
    listStockBalanceDiscrepancies,
  );
};

export default stockBalanceRoutes;
