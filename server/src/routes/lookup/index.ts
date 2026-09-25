import type { FastifyPluginAsync } from 'fastify';
import { listLookup } from '../../controllers/lookups';
import { PERMISSION_CODE } from '../../domain/permission-codes';
import { requirePermission, verifyToken } from '../../middleware/auth';
import { lookupListSchema } from '../../schemas/lookups';

const lookupRoutes: FastifyPluginAsync = async (fastify) => {
  const allLoggedIn = {
    preHandler: [
      verifyToken,
      requirePermission({
        anyOf: [
          PERMISSION_CODE.SUPPLY_ORDER_CREATE,
          PERMISSION_CODE.SUPPLY_ORDER_APPROVE,
          PERMISSION_CODE.SUPPLY_ORDER_ISSUE,
        ],
      }),
    ],
    schema: lookupListSchema,
  };
  const stockUsers = {
    preHandler: [verifyToken, requirePermission(PERMISSION_CODE.SUPPLY_STOCK_READ)],
    schema: lookupListSchema,
  };
  const systemManagers = {
    preHandler: [verifyToken, requirePermission(PERMISSION_CODE.ADMIN_ROLE_READ)],
    schema: lookupListSchema,
  };

  fastify.get(
    '/order-statuses',
    allLoggedIn,
    listLookup('order_statuses'),
  );
  fastify.get(
    '/stock-transaction-types',
    stockUsers,
    listLookup('stock_transaction_types'),
  );
  fastify.get(
    '/adjustment-reasons',
    stockUsers,
    listLookup('adjustment_reasons'),
  );
  fastify.get(
    '/allocation-confirm-reasons',
    {
      preHandler: [
        verifyToken,
        requirePermission(PERMISSION_CODE.SUPPLY_ORDER_CONFIRM_ALLOCATION),
      ],
      schema: lookupListSchema,
    },
    listLookup('allocation_confirm_reasons'),
  );
  fastify.get(
    '/order-revision-actions',
    systemManagers,
    listLookup('order_revision_actions'),
  );
};

export default lookupRoutes;
