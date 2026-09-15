import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  ShiftOrderSheetDetailQuery,
  ShiftOrderSheetIncomingQuery,
  ShiftOrderSheetListQuery,
} from '../../interfaces/shift-order-sheets';
import {
  ShiftOrderSheetServiceError,
  ShiftOrderSheetsService,
  type ShiftOrderSheetActor,
} from '../../services/shift-order-sheets.service';
import { AreaScopeServiceError } from '../../services/area-scopes.service';
import {
  isPaginatedResult,
  PaginationValidationError,
  toPaginatedResponse,
} from '../../utils/pagination';

const actorFrom = (request: FastifyRequest): ShiftOrderSheetActor => {
  if (!request.user) throw new ShiftOrderSheetServiceError(401, 'Unauthorized');
  return {
    id: request.user.id,
    areaId: request.user.areaId,
    roleIds: request.user.roleIds,
    permissions: request.user.permissions,
    isSystemAdmin: request.user.isSystemAdmin,
  };
};

const respond = async (
  request: FastifyRequest,
  reply: FastifyReply,
  handler: () => Promise<unknown>,
) => {
  try {
    const data = await handler();
    return reply.send(isPaginatedResult(data) ? toPaginatedResponse(data) : { data });
  } catch (error) {
    if (error instanceof PaginationValidationError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    if (error instanceof ShiftOrderSheetServiceError || error instanceof AreaScopeServiceError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'Internal server error' });
  }
};

export const listShiftOrderSheets = (request: FastifyRequest, reply: FastifyReply) =>
  respond(request, reply, () => new ShiftOrderSheetsService(request.server).list(
    actorFrom(request),
    request.query as ShiftOrderSheetListQuery,
  ));

export const getShiftOrderSheet = (request: FastifyRequest, reply: FastifyReply) =>
  respond(request, reply, () => new ShiftOrderSheetsService(request.server).get(
    actorFrom(request),
    (request.params as { id: string }).id,
    request.query as ShiftOrderSheetDetailQuery,
  ));

export const listIncomingShiftOrderSheets = (request: FastifyRequest, reply: FastifyReply) =>
  respond(request, reply, () => new ShiftOrderSheetsService(request.server).listIncoming(
    actorFrom(request),
    request.query as ShiftOrderSheetIncomingQuery,
  ));

export const getCurrentShiftOrderSheet = (request: FastifyRequest, reply: FastifyReply) =>
  respond(request, reply, () => new ShiftOrderSheetsService(request.server).getCurrent(
    actorFrom(request),
  ));

export const exportShiftOrderSheet = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    const result = await new ShiftOrderSheetsService(request.server).export(
      actorFrom(request),
      (request.params as { id: string }).id,
    );
    return reply
      .header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      .header('Content-Disposition', `attachment; filename="${result.fileName}"`)
      .header('Cache-Control', 'no-store')
      .send(result.buffer);
  } catch (error) {
    if (error instanceof ShiftOrderSheetServiceError || error instanceof AreaScopeServiceError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'Không thể tạo file Excel. Vui lòng thử lại.' });
  }
};
