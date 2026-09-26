import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  TeamsWebhookServiceError,
  TeamsWebhooksService,
} from '../../services/teams-webhooks.service';

const respond = async (
  request: FastifyRequest,
  reply: FastifyReply,
  handler: () => Promise<unknown>,
) => {
  try {
    return reply.send({ data: await handler() });
  } catch (error) {
    if (error instanceof TeamsWebhookServiceError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'Internal server error' });
  }
};

const hookCode = (request: FastifyRequest) => (request.params as { code: string }).code;

export const listTeamsWebhooks = (request: FastifyRequest, reply: FastifyReply) =>
  respond(request, reply, () => new TeamsWebhooksService(request.server).list());

export const updateTeamsWebhook = (request: FastifyRequest, reply: FastifyReply) =>
  respond(request, reply, () => new TeamsWebhooksService(request.server).setActive(
    hookCode(request),
    (request.body as { is_active: boolean }).is_active,
  ));

export const setTeamsWebhookUrl = (request: FastifyRequest, reply: FastifyReply) =>
  respond(request, reply, () => new TeamsWebhooksService(request.server).setUrl(
    hookCode(request),
    (request.body as { webhook_url: string }).webhook_url,
  ));

export const testTeamsWebhook = (request: FastifyRequest, reply: FastifyReply) =>
  respond(request, reply, () => new TeamsWebhooksService(request.server).sendTest(hookCode(request)));
