import type { FastifyPluginAsync } from 'fastify';
import { getMyStockAreaScopes } from '../../../controllers/stock-area-scopes';
import { PERMISSION_CODE } from '../../../domain/permission-codes';
import { requirePermission, verifyToken } from '../../../middleware/auth';

const routes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', {
    preHandler: [
      verifyToken,
      requirePermission(PERMISSION_CODE.SUPPLY_STOCK_READ),
    ],
    schema: {
      querystring: { type: 'object', additionalProperties: false, properties: {} },
    },
  }, getMyStockAreaScopes);
};

export default routes;
