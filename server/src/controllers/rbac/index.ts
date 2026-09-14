import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  PermissionListQuery,
  ReplaceRoleAreaTypeScopesBody,
  ReplaceRolePermissionsBody,
  ReplaceUserRolesBody,
} from '../../interfaces/rbac';
import { RbacService } from '../../services/rbac.service';
import { respondWithData } from '../master-data-response';

export const listPermissions = (request: FastifyRequest, reply: FastifyReply) =>
  respondWithData(request, reply, () =>
    new RbacService(request.server).listPermissions(request.query as PermissionListQuery));

export const getRolePermissions = (request: FastifyRequest, reply: FastifyReply) =>
  respondWithData(request, reply, () => new RbacService(request.server).getRolePermissions(
    (request.params as { id: string }).id,
  ));

export const replaceRolePermissions = (request: FastifyRequest, reply: FastifyReply) =>
  respondWithData(request, reply, () => new RbacService(request.server).replaceRolePermissions(
    (request.params as { id: string }).id,
    request.body as ReplaceRolePermissionsBody,
    request.user.id,
  ));

export const listAreaTypes = (request: FastifyRequest, reply: FastifyReply) =>
  respondWithData(request, reply, () => new RbacService(request.server).listAreaTypes());

export const getRoleAreaTypeScopes = (request: FastifyRequest, reply: FastifyReply) =>
  respondWithData(request, reply, () => new RbacService(request.server).getRoleAreaTypeScopes(
    (request.params as { id: string }).id,
  ));

export const replaceRoleAreaTypeScopes = (request: FastifyRequest, reply: FastifyReply) =>
  respondWithData(request, reply, () => new RbacService(request.server).replaceRoleAreaTypeScopes(
    (request.params as { id: string }).id,
    request.body as ReplaceRoleAreaTypeScopesBody,
    request.user.id,
  ));

export const getUserRoles = (request: FastifyRequest, reply: FastifyReply) =>
  respondWithData(request, reply, () => new RbacService(request.server).getUserRoles(
    (request.params as { id: string }).id,
  ));

export const replaceUserRoles = (request: FastifyRequest, reply: FastifyReply) =>
  respondWithData(request, reply, () => new RbacService(request.server).replaceUserRoles(
    (request.params as { id: string }).id,
    request.body as ReplaceUserRolesBody,
    request.user.id,
  ));
