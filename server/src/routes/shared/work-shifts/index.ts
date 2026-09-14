import type { FastifyPluginAsync } from 'fastify';
import { listWorkShifts } from '../../../controllers/work-shifts';
import { PERMISSION_CODE } from '../../../domain/permission-codes';
import { ORDER_READ_PERMISSIONS } from '../../../domain/order-access';
import { requirePermission, verifyToken } from '../../../middleware/auth';

const workShiftRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/',
    {
      preHandler: [
        verifyToken,
        requirePermission({
          anyOf: [
            PERMISSION_CODE.ADMIN_USER_READ,
            ...ORDER_READ_PERMISSIONS,
          ],
        }),
      ],
    },
    listWorkShifts,
  );
};

export default workShiftRoutes;
