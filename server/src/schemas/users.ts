import type { FastifySchema } from 'fastify';
import { createListQuerySchema } from './pagination';

const uuid = { type: 'string', format: 'uuid' } as const;
const nullableUuid = { anyOf: [uuid, { type: 'null' }] } as const;
const nullableText = {
  anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }],
} as const;
const optionalBoolean = {
  anyOf: [{ type: 'boolean' }, { type: 'string', enum: ['true', 'false'] }],
} as const;

export const USER_SORT_FIELDS = [
  'id', 'email', 'vinfast_id', 'first_name', 'last_name', 'is_active',
  'is_verified', 'created_at', 'updated_at',
] as const;

export const userListSchema = createListQuerySchema(USER_SORT_FIELDS, {
  roleId: uuid,
  areaId: uuid,
  isActive: optionalBoolean,
});

export const loginSchema: FastifySchema = {
  tags: ['Auth'],
  summary: 'Đăng nhập bằng VinFast ID và mật khẩu',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['vinfast_id', 'password'],
    properties: {
      vinfast_id: { type: 'string', minLength: 1, maxLength: 50 },
      password: { type: 'string', minLength: 1, maxLength: 128 },
    },
  },
};

export const refreshSessionSchema: FastifySchema = {
  tags: ['Auth'],
  summary: 'Xoay refresh session cookie và cấp access token mới',
  description: 'Không yêu cầu Bearer token. Refresh token chỉ được đọc từ HttpOnly cookie.',
};

export const logoutSchema: FastifySchema = {
  tags: ['Auth'],
  summary: 'Thu hồi refresh session hiện tại và xóa cookie',
  description: 'Idempotent; chỉ thu hồi phiên của thiết bị hiện tại.',
};

const userProfileProperties = {
  email: { type: 'string', format: 'email', maxLength: 320 },
  first_name: { type: 'string', minLength: 1, maxLength: 255 },
  last_name: { type: 'string', minLength: 1, maxLength: 255 },
  vinfast_id: { type: 'string', minLength: 1, maxLength: 50 },
  phone_number: nullableText,
  avatar_url: nullableText,
  area_id: uuid,
  managed_by_user_id: nullableUuid,
} as const;

const userMutableProperties = {
  ...userProfileProperties,
  is_active: { type: 'boolean' },
  is_verified: { type: 'boolean' },
  is_deleted: { type: 'boolean' },
} as const;

export const createUserSchema: FastifySchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: [
      'email',
      'password',
      'first_name',
      'last_name',
      'vinfast_id',
      'role_ids',
      'area_id',
    ],
    properties: {
      ...userProfileProperties,
      role_ids: { type: 'array', minItems: 1, uniqueItems: true, items: uuid },
      password: { type: 'string', minLength: 9, maxLength: 128 },
    },
  },
};

export const updateUserSchema: FastifySchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: uuid },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: userMutableProperties,
  },
};

export const userIdParamsSchema: FastifySchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: uuid },
  },
};

export const updatePasswordSchema: FastifySchema = {
  ...userIdParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['newPassword', 'confirmNewPassword'],
    properties: {
      currentPassword: { type: 'string', minLength: 1, maxLength: 128 },
      newPassword: { type: 'string', minLength: 9, maxLength: 128 },
      confirmNewPassword: { type: 'string', minLength: 9, maxLength: 128 },
    },
  },
};
