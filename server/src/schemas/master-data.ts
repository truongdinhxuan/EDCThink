import type { FastifySchema } from 'fastify';
import { createListQuerySchema } from './pagination';

const uuid = { type: 'string', format: 'uuid' } as const;
const nullableText = {
  anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }],
} as const;
const active = { type: 'boolean' } as const;
const optionalBoolean = {
  anyOf: [{ type: 'boolean' }, { type: 'string', enum: ['true', 'false'] }],
} as const;
const legacySearch = { type: 'string', maxLength: 100 } as const;

export const ROLE_SORT_FIELDS = [
  'id', 'code', 'name', 'is_system', 'is_active', 'created_at', 'updated_at',
] as const;
export const AREA_SORT_FIELDS = [
  'id', 'code', 'name', 'description', 'is_active', 'created_at', 'updated_at',
] as const;
export const CATEGORY_SORT_FIELDS = [
  'id', 'code', 'name', 'description', 'is_active', 'created_at', 'updated_at',
] as const;
export const UNIT_SORT_FIELDS = [
  'id', 'code', 'symbol', 'name', 'description', 'is_active', 'created_at', 'updated_at',
] as const;
export const SUPPLY_SORT_FIELDS = [
  'id', 'code', 'short_text', 'translation_text', 'description',
  'min_stock', 'max_stock', 'safety_stock',
  'is_active', 'created_at', 'updated_at',
] as const;
export const STORAGE_LOCATION_SORT_FIELDS = [
  'id', 'code', 'name', 'area_id', 'description', 'is_active', 'created_at', 'updated_at',
] as const;
export const PROVIDER_SORT_FIELDS = [
  'code', 'name', 'created_at', 'updated_at', 'is_active',
] as const;

const objectBody = (
  properties: Record<string, unknown>,
  required: string[] = [],
): FastifySchema['body'] => ({
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  ...(required.length ? { required } : {}),
  properties,
});

export const idParamsSchema: FastifySchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: uuid },
  },
};

export const roleListQuerySchema = createListQuerySchema(ROLE_SORT_FIELDS, {
  isActive: optionalBoolean,
});
export const areaListQuerySchema = createListQuerySchema(AREA_SORT_FIELDS, {
  q: legacySearch,
  areaTypeId: uuid,
  is_active: optionalBoolean,
  isActive: optionalBoolean,
});
export const categoryListQuerySchema = createListQuerySchema(CATEGORY_SORT_FIELDS, {
  q: legacySearch,
  is_active: optionalBoolean,
  isActive: optionalBoolean,
});
export const unitListQuerySchema = createListQuerySchema(UNIT_SORT_FIELDS, {
  q: legacySearch,
  is_active: optionalBoolean,
  isActive: optionalBoolean,
});

export const roleCreateSchema: FastifySchema = {
  body: objectBody(
    {
      code: {
        type: 'string',
        minLength: 2,
        maxLength: 100,
        pattern: '^[A-Za-z][A-Za-z0-9_]*$',
      },
      name: { type: 'string', minLength: 1, maxLength: 255 },
      description: nullableText,
      is_active: active,
    },
    ['code', 'name'],
  ),
};

export const roleUpdateSchema: FastifySchema = {
  ...idParamsSchema,
  body: objectBody({
    code: {
      type: 'string',
      minLength: 2,
      maxLength: 100,
      pattern: '^[A-Za-z][A-Za-z0-9_]*$',
    },
    name: { type: 'string', minLength: 1, maxLength: 255 },
    description: nullableText,
    is_active: active,
  }),
};

const areaProperties = {
  code: { type: 'string', minLength: 1, maxLength: 100 },
  name: { type: 'string', minLength: 1, maxLength: 255 },
  description: nullableText,
  area_type_id: { anyOf: [uuid, { type: 'null' }] },
  is_active: active,
} as const;

export const areaCreateSchema: FastifySchema = {
  body: objectBody(areaProperties, ['code', 'name']),
};

export const areaUpdateSchema: FastifySchema = {
  ...idParamsSchema,
  body: objectBody(areaProperties),
};

const categoryProperties = {
  code: { type: 'string', minLength: 1, maxLength: 100 },
  name: { type: 'string', minLength: 1, maxLength: 255 },
  description: nullableText,
  is_active: active,
} as const;

export const categoryCreateSchema: FastifySchema = {
  body: objectBody(categoryProperties, ['code', 'name']),
};

export const categoryUpdateSchema: FastifySchema = {
  ...idParamsSchema,
  body: objectBody(categoryProperties),
};

const unitProperties = {
  code: { type: 'string', minLength: 1, maxLength: 100 },
  symbol: { type: 'string', minLength: 1, maxLength: 100 },
  name: { type: 'string', minLength: 1, maxLength: 255 },
  description: nullableText,
  is_active: active,
} as const;

export const unitCreateSchema: FastifySchema = {
  body: objectBody(unitProperties, ['code', 'symbol', 'name']),
};

export const unitUpdateSchema: FastifySchema = {
  ...idParamsSchema,
  body: objectBody(unitProperties),
};

const nullableNumber = {
  anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }],
} as const;
const supplyProperties = {
  code: { type: 'string', minLength: 1, maxLength: 100 },
  short_text: { type: 'string', minLength: 1, maxLength: 255 },
  translation_text: nullableText,
  description: nullableText,
  category_id: uuid,
  unit_id: uuid,
  min_stock: nullableNumber,
  max_stock: nullableNumber,
  safety_stock: nullableNumber,
  image_url: nullableText,
  is_active: active,
  provider_ids: {
    type: 'array',
    minItems: 1,
    items: uuid,
  },
} as const;

export const supplyCreateSchema: FastifySchema = {
  body: objectBody(
    supplyProperties,
    ['code', 'short_text', 'category_id', 'unit_id', 'provider_ids'],
  ),
};

export const supplyUpdateSchema: FastifySchema = {
  ...idParamsSchema,
  body: objectBody(supplyProperties, ['provider_ids']),
};

export const supplyProviderListQuerySchema: FastifySchema = {
  ...idParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      isActive: optionalBoolean,
      isDeleted: optionalBoolean,
    },
  },
};

export const supplyStackOptionsSchema: FastifySchema = {
  ...idParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    required: ['provider_id', 'area_id'],
    properties: {
      provider_id: uuid,
      area_id: uuid,
    },
  },
};

export const supplyListQuerySchema = createListQuerySchema(SUPPLY_SORT_FIELDS, {
  q: legacySearch,
  category_id: uuid,
  categoryId: uuid,
  unitId: uuid,
  is_active: optionalBoolean,
  isActive: optionalBoolean,
  isDeleted: optionalBoolean,
});

const storageLocationProperties = {
  code: { type: 'string', minLength: 1, maxLength: 100 },
  area_id: uuid,
  name: nullableText,
  description: nullableText,
  is_active: active,
} as const;

export const storageLocationCreateSchema: FastifySchema = {
  body: objectBody(storageLocationProperties, ['code', 'area_id']),
};

export const storageLocationUpdateSchema: FastifySchema = {
  ...idParamsSchema,
  body: objectBody(storageLocationProperties),
};

export const storageLocationListQuerySchema = createListQuerySchema(
  STORAGE_LOCATION_SORT_FIELDS,
  {
    area_id: uuid,
    areaId: uuid,
    q: legacySearch,
    is_active: optionalBoolean,
    isActive: optionalBoolean,
  },
);

const providerProperties = {
  code: { type: 'string', minLength: 1, maxLength: 100 },
  name: { type: 'string', minLength: 1, maxLength: 255 },
  description: nullableText,
  is_active: active,
} as const;

export const providerListQuerySchema = createListQuerySchema(
  PROVIDER_SORT_FIELDS,
  {
    isActive: optionalBoolean,
    isDeleted: optionalBoolean,
  },
);

export const providerCreateSchema: FastifySchema = {
  body: objectBody(providerProperties, ['code', 'name']),
};

export const providerUpdateSchema: FastifySchema = {
  ...idParamsSchema,
  body: objectBody(providerProperties),
};
