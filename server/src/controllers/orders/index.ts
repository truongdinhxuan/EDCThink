import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  ApproveOrderBody,
  CancelOrderBody,
  ConfirmStackItemBody,
  CreateOrderBody,
  IssueOrderBody,
  OrderListQuery,
  PatchOrderBody,
  ReceiveOrderBody,
  RejectOrderBody,
} from '../../interfaces/orders';
import {
  OrderService,
  OrderServiceError,
  type OrderActor,
} from '../../services/orders.service';
import {
  isPaginatedResult,
  PaginationValidationError,
  toPaginatedResponse,
} from '../../utils/pagination';

const actorFrom = (request: FastifyRequest): OrderActor => {
  if (!request.user) throw new OrderServiceError(401, 'Unauthorized');
  return {
    id: request.user.id,
    areaId: request.user.areaId,
    permissions: request.user.permissions,
    isSystemAdmin: request.user.isSystemAdmin,
  };
};

const respond = async (
  request: FastifyRequest,
  reply: FastifyReply,
  handler: () => Promise<unknown>,
  successCode = 200,
) => {
  try {
    const data = await handler();
    return reply.code(successCode).send(
      isPaginatedResult(data) ? toPaginatedResponse(data) : { data },
    );
  } catch (error) {
    if (error instanceof PaginationValidationError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    if (error instanceof OrderServiceError) {
      return reply.code(error.statusCode).send({
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
        ...(error.details ? { details: error.details } : {}),
      });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'Internal server error' });
  }
};

export const createOrder = (request: FastifyRequest, reply: FastifyReply) =>
  respond(
    request,
    reply,
    () => new OrderService(request.server).create(actorFrom(request), request.body as CreateOrderBody),
    201,
  );

export const patchOrder = (request: FastifyRequest, reply: FastifyReply) =>
  respond(request, reply, () =>
    new OrderService(request.server).patch(
      actorFrom(request),
      (request.params as { id: string }).id,
      request.body as PatchOrderBody,
    ),
  );

export const listOrders = (request: FastifyRequest, reply: FastifyReply) =>
  respond(request, reply, () =>
    new OrderService(request.server).list(
      actorFrom(request),
      request.query as OrderListQuery,
    ),
  );

export const getOrder = (request: FastifyRequest, reply: FastifyReply) =>
  respond(request, reply, () =>
    new OrderService(request.server).get(
      actorFrom(request),
      (request.params as { id: string }).id,
    ),
  );

export const approveOrder = (request: FastifyRequest, reply: FastifyReply) =>
  respond(request, reply, () =>
    new OrderService(request.server).approve(
      actorFrom(request),
      (request.params as { id: string }).id,
      request.body as ApproveOrderBody,
    ),
  );

export const confirmOrderStackItem = (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const params = request.params as { id: string; itemId: string };
  return respond(request, reply, () =>
    new OrderService(request.server).confirmStackItem(
      actorFrom(request),
      params.id,
      params.itemId,
      request.body as ConfirmStackItemBody,
    ),
  );
};

export const rejectOrder = (request: FastifyRequest, reply: FastifyReply) =>
  respond(request, reply, () =>
    new OrderService(request.server).reject(
      actorFrom(request),
      (request.params as { id: string }).id,
      request.body as RejectOrderBody,
    ),
  );

export const issueOrder = (request: FastifyRequest, reply: FastifyReply) =>
  respond(request, reply, () =>
    new OrderService(request.server).issue(
      actorFrom(request),
      (request.params as { id: string }).id,
      request.body as IssueOrderBody,
    ),
  );

export const receiveOrder = (request: FastifyRequest, reply: FastifyReply) =>
  respond(request, reply, () =>
    new OrderService(request.server).receive(
      actorFrom(request),
      (request.params as { id: string }).id,
      (request.body ?? {}) as ReceiveOrderBody,
    ),
  );

export const completeOrder = (request: FastifyRequest, reply: FastifyReply) =>
  respond(request, reply, () =>
    new OrderService(request.server).complete(
      actorFrom(request),
      (request.params as { id: string }).id,
    ),
  );

export const cancelOrder = (request: FastifyRequest, reply: FastifyReply) =>
  respond(request, reply, () =>
    new OrderService(request.server).cancel(
      actorFrom(request),
      (request.params as { id: string }).id,
      (request.body ?? {}) as CancelOrderBody,
    ),
  );
