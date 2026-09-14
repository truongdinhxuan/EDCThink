import type { FastifySchema } from 'fastify';
import { createListQuerySchema } from './pagination';

const uuid = { type: 'string', format: 'uuid' } as const;
const idParams = {
  type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid },
} as const;

export const PERMISSION_SORT_FIELDS = [
  'code', 'name', 'module', 'created_at', 'updated_at',
] as const;

export const permissionListSchema = createListQuerySchema(PERMISSION_SORT_FIELDS, {
  module: { type: 'string', minLength: 1, maxLength: 100 },
});

export const rolePermissionParamsSchema: FastifySchema = { params: idParams };
export const replaceRolePermissionsSchema: FastifySchema = {
  params: idParams,
  body: {
    type: 'object', additionalProperties: false, required: ['permission_ids'],
    properties: {
      permission_ids: { type: 'array', uniqueItems: true, items: uuid },
    },
  },
};

export const roleAreaTypeScopeParamsSchema: FastifySchema = { params: idParams };
export const replaceRoleAreaTypeScopesSchema: FastifySchema = {
  params: idParams,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['areaTypeIds'],
    properties: {
      areaTypeIds: { type: 'array', maxItems: 100, items: uuid },
    },
  },
};

export const userRoleParamsSchema: FastifySchema = { params: idParams };
export const replaceUserRolesSchema: FastifySchema = {
  params: idParams,
  body: {
    type: 'object', additionalProperties: false, required: ['role_ids'],
    properties: {
      role_ids: { type: 'array', minItems: 1, uniqueItems: true, items: uuid },
    },
  },
};
