import type { FastifyPluginAsync } from 'fastify';
import {
  createArea,
  deleteArea,
  getArea,
  listAreas,
  updateArea,
} from '../../controllers/areas';
import { PERMISSION_CODE } from '../../domain/permission-codes';
import { requirePermission, verifyToken } from '../../middleware/auth';
import {
  areaListQuerySchema,
  areaCreateSchema,
  areaUpdateSchema,
  idParamsSchema,
} from '../../schemas/master-data';

const areaRoutes: FastifyPluginAsync = async (fastify) => {
  const areaReadPermission = [verifyToken, requirePermission(PERMISSION_CODE.SUPPLY_AREA_READ)];
  fastify.get(
    '/',
    { preHandler: areaReadPermission, schema: areaListQuerySchema },
    listAreas,
  );
  fastify.get(
    '/:id',
    { preHandler: areaReadPermission, schema: idParamsSchema },
    getArea,
  );
  fastify.post(
    '/',
    { preHandler: [verifyToken, requirePermission(PERMISSION_CODE.SUPPLY_AREA_CREATE)], schema: areaCreateSchema },
    createArea,
  );
  fastify.patch(
    '/:id',
    { preHandler: [verifyToken, requirePermission(PERMISSION_CODE.SUPPLY_AREA_UPDATE)], schema: areaUpdateSchema },
    updateArea,
  );
  fastify.delete(
    '/:id',
    { preHandler: [verifyToken, requirePermission(PERMISSION_CODE.SUPPLY_AREA_DEACTIVATE)], schema: idParamsSchema },
    deleteArea,
  );
};

export default areaRoutes;
