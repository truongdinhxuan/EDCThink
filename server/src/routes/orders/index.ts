import type { FastifyPluginAsync } from 'fastify';
import {
  allocateOrder,
  approveOrder,
  cancelOrder,
  completeOrder,
  createOrder,
  getOrder,
  issueOrder,
  listOrders,
  patchOrder,
  receiveOrder,
  rejectOrder,
  confirmOrderAllocation,
} from '../../controllers/orders';
import { PERMISSION_CODE } from '../../domain/permission-codes';
import { ORDER_READ_PERMISSIONS } from '../../domain/order-access';
import { requirePermission, verifyToken } from '../../middleware/auth';
import {
  orderCreateSchema,
  orderApproveSchema,
  orderListSchema,
  orderPatchSchema,
  allocationConfirmSchema,
  orderIssueSchema,
} from '../../schemas/orders';

const orderRoutes: FastifyPluginAsync = async (fastify) => {
  const ownerPermission = [
    verifyToken,
    requirePermission(PERMISSION_CODE.SUPPLY_ORDER_CREATE),
  ];
  const orderReadPermission = [
    verifyToken,
    requirePermission({
      anyOf: [
        ...ORDER_READ_PERMISSIONS,
      ],
    }),
  ];
  const orderReviewPermission = [
    verifyToken,
    requirePermission(PERMISSION_CODE.SUPPLY_ORDER_APPROVE),
  ];
  const orderIssuePermission = [
    verifyToken,
    requirePermission(PERMISSION_CODE.SUPPLY_ORDER_ISSUE),
  ];
  const orderAllocatePermission = [
    verifyToken,
    requirePermission(PERMISSION_CODE.SUPPLY_ORDER_ALLOCATE),
  ];
  const orderConfirmAllocationPermission = [
    verifyToken,
    requirePermission(PERMISSION_CODE.SUPPLY_ORDER_CONFIRM_ALLOCATION),
  ];
  fastify.post(
    '/',
    { preHandler: ownerPermission, schema: orderCreateSchema },
    createOrder,
  );
  fastify.patch(
    '/:id',
    { preHandler: ownerPermission, schema: orderPatchSchema },
    patchOrder,
  );
  fastify.get(
    '/',
    { preHandler: orderReadPermission, schema: orderListSchema },
    listOrders,
  );
  fastify.get('/:id', { preHandler: orderReadPermission }, getOrder);
  fastify.post(
    '/:id/approve',
    { preHandler: orderReviewPermission, schema: orderApproveSchema },
    approveOrder,
  );
  fastify.post(
    '/:id/reject',
    { preHandler: orderReviewPermission },
    rejectOrder,
  );
  fastify.post(
    '/:id/allocate',
    { preHandler: orderAllocatePermission },
    allocateOrder,
  );
  fastify.post(
    '/:id/allocations/:allocationId/confirm',
    {
      preHandler: orderConfirmAllocationPermission,
      schema: allocationConfirmSchema,
    },
    confirmOrderAllocation,
  );
  fastify.post(
    '/:id/issue',
    { preHandler: orderIssuePermission, schema: orderIssueSchema },
    issueOrder,
  );
  fastify.post(
    '/:id/receive',
    { preHandler: ownerPermission },
    receiveOrder,
  );
  fastify.post(
    '/:id/complete',
    { preHandler: orderIssuePermission },
    completeOrder,
  );
  fastify.post(
    '/:id/cancel',
    { preHandler: ownerPermission },
    cancelOrder,
  );
};

export default orderRoutes;
