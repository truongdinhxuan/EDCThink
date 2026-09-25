import type { FastifyReply, FastifyRequest } from 'fastify';
import type { TeamsFunctionCode } from '../../teams/registry';
import {
  TeamsWorkflowServiceError,
  TeamsWorkflowsService,
  type SaveTeamsWorkflowBody,
  type TeamsDeliveryListQuery,
} from '../../services/teams-workflows.service';
import {
  isPaginatedResult,
  PaginationValidationError,
  toPaginatedResponse,
} from '../../utils/pagination';

const respond = async (
  request: FastifyRequest,
  reply: FastifyReply,
  handler: () => Promise<unknown>,
) => {
  try {
    const data = await handler();
    return reply.send(isPaginatedResult(data) ? toPaginatedResponse(data) : { data });
  } catch (error) {
    if (error instanceof PaginationValidationError || error instanceof TeamsWorkflowServiceError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'Internal server error' });
  }
};

const functionCode = (request: FastifyRequest) =>
  (request.params as { function_code: TeamsFunctionCode }).function_code;

export const listTeamsWorkflows = (request: FastifyRequest, reply: FastifyReply) =>
  respond(request, reply, () => new TeamsWorkflowsService(request.server).list());

export const saveTeamsWorkflow = (request: FastifyRequest, reply: FastifyReply) =>
  respond(request, reply, () => new TeamsWorkflowsService(request.server).save(
    functionCode(request),
    request.body as SaveTeamsWorkflowBody,
    request.user!.id,
  ));

export const testTeamsWorkflow = (request: FastifyRequest, reply: FastifyReply) =>
  respond(request, reply, () => new TeamsWorkflowsService(request.server).sendTest(
    functionCode(request),
    request.user!.id,
  ));

export const listTeamsDeliveries = (request: FastifyRequest, reply: FastifyReply) =>
  respond(request, reply, () => new TeamsWorkflowsService(request.server).listDeliveries(
    request.query as TeamsDeliveryListQuery,
  ));

export const retryTeamsDelivery = (request: FastifyRequest, reply: FastifyReply) =>
  respond(request, reply, () => new TeamsWorkflowsService(request.server).retry(
    (request.params as { id: string }).id,
  ));
