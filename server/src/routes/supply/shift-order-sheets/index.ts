import type { FastifyPluginAsync } from 'fastify';
import {
  exportShiftOrderSheet,
  getCurrentShiftOrderSheet,
  getShiftOrderSheet,
  listIncomingShiftOrderSheets,
  listShiftOrderSheets,
} from '../../../controllers/shift-order-sheets';
import { PERMISSION_CODE } from '../../../domain/permission-codes';
import { requirePermission, verifyToken } from '../../../middleware/auth';
import {
  shiftOrderSheetDetailSchema,
  shiftOrderSheetCurrentSchema,
  shiftOrderSheetExportSchema,
  shiftOrderSheetIncomingSchema,
  shiftOrderSheetListSchema,
} from '../../../schemas/shift-order-sheets';

const routes: FastifyPluginAsync = async (fastify) => {
  // Sheet read stays a permission of its own, independent from Order authority
  // (T14-T16). A role that should work on Sheets is given the read code through
  // role configuration, not by inheriting it from supply.order.*.
  const readPermission = [
    verifyToken,
    requirePermission(PERMISSION_CODE.SUPPLY_SHIFT_ORDER_SHEET_READ),
  ];

  fastify.get('/', {
    preHandler: readPermission,
    schema: shiftOrderSheetListSchema,
  }, listShiftOrderSheets);

  fastify.get('/current', {
    preHandler: readPermission,
    schema: shiftOrderSheetCurrentSchema,
  }, getCurrentShiftOrderSheet);

  // Reviewing what the markets ordered is an approval activity.
  fastify.get('/incoming', {
    preHandler: [
      verifyToken,
      requirePermission(PERMISSION_CODE.SUPPLY_ORDER_APPROVE),
    ],
    schema: shiftOrderSheetIncomingSchema,
  }, listIncomingShiftOrderSheets);

  fastify.get('/:id', {
    preHandler: readPermission,
    schema: shiftOrderSheetDetailSchema,
  }, getShiftOrderSheet);

  fastify.get('/:id/export', {
    preHandler: readPermission,
    schema: shiftOrderSheetExportSchema,
  }, exportShiftOrderSheet);
};

export default routes;
