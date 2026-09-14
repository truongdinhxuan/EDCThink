import type { FastifyPluginAsync } from 'fastify';
import {
  exportShiftOrderSheet,
  getCurrentShiftOrderSheet,
  getShiftOrderSheet,
  listShiftOrderSheets,
} from '../../../controllers/shift-order-sheets';
import { PERMISSION_CODE } from '../../../domain/permission-codes';
import { requirePermission, verifyToken } from '../../../middleware/auth';
import {
  shiftOrderSheetDetailSchema,
  shiftOrderSheetCurrentSchema,
  shiftOrderSheetExportSchema,
  shiftOrderSheetListSchema,
} from '../../../schemas/shift-order-sheets';

const routes: FastifyPluginAsync = async (fastify) => {
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
