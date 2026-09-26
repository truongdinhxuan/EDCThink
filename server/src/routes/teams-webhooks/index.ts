import type { FastifyPluginAsync } from 'fastify';
import {
  listTeamsWebhooks,
  setTeamsWebhookUrl,
  testTeamsWebhook,
  updateTeamsWebhook,
} from '../../controllers/teams-webhooks';
import { PERMISSION_CODE } from '../../domain/permission-codes';
import { requirePermission, verifyToken } from '../../middleware/auth';
import {
  teamsWebhookTestSchema,
  teamsWebhookUpdateSchema,
  teamsWebhookUrlSchema,
} from '../../schemas/teams-webhooks';

const teamsWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  const canView = [verifyToken, requirePermission(PERMISSION_CODE.TEAMS_WEBHOOK_VIEW)];
  const canManage = [verifyToken, requirePermission(PERMISSION_CODE.TEAMS_WEBHOOK_MANAGE)];

  fastify.get('/', { preHandler: canView }, listTeamsWebhooks);
  fastify.patch('/:code', { preHandler: canManage, schema: teamsWebhookUpdateSchema }, updateTeamsWebhook);
  fastify.put('/:code/url', { preHandler: canManage, schema: teamsWebhookUrlSchema }, setTeamsWebhookUrl);
  fastify.post('/:code/test', { preHandler: canManage, schema: teamsWebhookTestSchema }, testTeamsWebhook);
};

export default teamsWebhookRoutes;
