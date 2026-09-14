import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AreaScopeActor } from '../../interfaces/area-scopes';
import {
  AreaScopeServiceError,
  AreaScopesService,
} from '../../services/area-scopes.service';

const actorFrom = (request: FastifyRequest): AreaScopeActor => {
  if (!request.user) throw new AreaScopeServiceError(401, 'Unauthorized');
  return {
    id: request.user.id,
    areaId: request.user.areaId,
    roleIds: request.user.roleIds,
    isSystemAdmin: request.user.isSystemAdmin,
  };
};

export const getMyAreaScopes = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    const areaTypes = await new AreaScopesService(
      request.server,
      actorFrom(request),
    ).getEffectiveAreaTypeScopes();
    return reply.send({ data: { areaTypes } });
  } catch (error) {
    if (error instanceof AreaScopeServiceError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'Internal server error' });
  }
};
