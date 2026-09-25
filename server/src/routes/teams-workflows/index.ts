import type { FastifyPluginAsync } from 'fastify';
import {
  listTeamsDeliveries,
  listTeamsWorkflows,
  retryTeamsDelivery,
  saveTeamsWorkflow,
  testTeamsWorkflow,
} from '../../controllers/teams-workflows';
import { PERMISSION_CODE } from '../../domain/permission-codes';
import { requirePermission, verifyToken } from '../../middleware/auth';
import {
  teamsDeliveryListSchema,
  teamsDeliveryRetrySchema,
  teamsWorkflowSaveSchema,
  teamsWorkflowTestSchema,
} from '../../schemas/teams-workflows';

const teamsWorkflowRoutes: FastifyPluginAsync = async (fastify) => {
  const canView = [verifyToken, requirePermission(PERMISSION_CODE.TEAMS_WEBHOOK_VIEW)];
  const canManage = [verifyToken, requirePermission(PERMISSION_CODE.TEAMS_WEBHOOK_MANAGE)];

  fastify.get('/', { preHandler: canView }, listTeamsWorkflows);
  // Registered before '/:function_code' so the literal segment wins.
  fastify.get('/deliveries', { preHandler: canView, schema: teamsDeliveryListSchema }, listTeamsDeliveries);
  fastify.post('/deliveries/:id/retry', { preHandler: canManage, schema: teamsDeliveryRetrySchema }, retryTeamsDelivery);
  fastify.put('/:function_code', { preHandler: canManage, schema: teamsWorkflowSaveSchema }, saveTeamsWorkflow);
  fastify.post('/:function_code/test', { preHandler: canManage, schema: teamsWorkflowTestSchema }, testTeamsWorkflow);
};

export default teamsWorkflowRoutes;
