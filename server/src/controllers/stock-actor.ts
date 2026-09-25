import type { FastifyRequest } from 'fastify';
import type { StockActor } from '../interfaces/stock';

/**
 * Everything the stock Area rules need, taken from the verified request.
 *
 * Built in one place so no stock endpoint can accidentally construct a partial
 * actor — a missing `isSystemAdmin` or `roleIds` would not fail loudly, it would
 * quietly narrow or widen what that request may see.
 */
export const stockActor = (request: FastifyRequest): StockActor => ({
  id: request.user.id,
  areaId: request.user.areaId ?? null,
  roleIds: request.user.roleIds,
  permissions: request.user.permissions,
  isSystemAdmin: request.user.isSystemAdmin,
});
