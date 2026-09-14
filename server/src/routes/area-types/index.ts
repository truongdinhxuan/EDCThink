import type { FastifyPluginAsync } from 'fastify';
import { listAreaTypes } from '../../controllers/rbac';
import { PERMISSION_CODE } from '../../domain/permission-codes';
import { requirePermission, verifyToken } from '../../middleware/auth';

const areaTypeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', {
    preHandler: [verifyToken, requirePermission({
      anyOf: [PERMISSION_CODE.ADMIN_ROLE_READ, PERMISSION_CODE.SUPPLY_AREA_READ],
    })],
  }, listAreaTypes);
};

export default areaTypeRoutes;
