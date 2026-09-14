import type { FastifyPluginAsync } from 'fastify';
import { getMyAreaScopes } from '../../../controllers/area-scopes';
import { PERMISSION_CODE } from '../../../domain/permission-codes';
import { requirePermission, verifyToken } from '../../../middleware/auth';

const routes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', {
    preHandler: [
      verifyToken,
      requirePermission(PERMISSION_CODE.SUPPLY_SHIFT_ORDER_SHEET_READ),
    ],
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    },
  }, getMyAreaScopes);
};

export default routes;
