import type { FastifySchema } from 'fastify';
import { STOCK_ADJUSTMENT_TYPES } from '../domain/stockRules';
import { createListQuerySchema } from './pagination';

const uuid = { type: 'string', format: 'uuid' } as const;

export const STOCK_BALANCE_SORT_FIELDS = [
  'id', 'quantity', 'supply_id', 'provider_id', 'area_id',
  'created_at', 'updated_at',
] as const;

const locationIds = {
  type: 'array',
  maxItems: 50,
  uniqueItems: true,
  items: uuid,
} as const;
export const STOCK_TRANSACTION_SORT_FIELDS = [
  'id', 'type', 'transaction_type_id', 'quantity', 'before_quantity', 'after_quantity', 'supply_id',
  'provider_id', 'area_id', 'storage_location_id', 'created_by', 'created_at',
] as const;

export const stockIdParamsSchema: FastifySchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: uuid },
  },
};

export const stockBalanceListSchema = createListQuerySchema(
  STOCK_BALANCE_SORT_FIELDS,
  {
    supply_id: uuid,
    supplyId: uuid,
    provider_id: uuid,
    providerId: uuid,
    area_id: uuid,
    areaId: uuid,
    storage_location_id: uuid,
    storageLocationId: uuid,
    warning: { type: 'string', enum: ['all', 'warning', 'no_warning'] },
  },
);

export const inventoryDiscrepancyListSchema: FastifySchema = {
  ...createListQuerySchema(
    ['reported_at', 'created_at', 'status'] as const,
    { status: { type: 'string', enum: ['OPEN', 'RESOLVED'] } },
  ),
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: uuid },
  },
};

export const inventoryDiscrepancyResolveSchema: FastifySchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: uuid },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['resolution_note'],
    properties: {
      resolution_note: { type: 'string', minLength: 1, maxLength: 2000 },
    },
  },
};

export const stockBalanceLocationsReplaceSchema: FastifySchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: uuid },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['location_ids'],
    properties: { location_ids: locationIds },
  },
};

export const stockTransactionListSchema = createListQuerySchema(
  STOCK_TRANSACTION_SORT_FIELDS,
  {
    supply_id: uuid,
    supplyId: uuid,
    provider_id: uuid,
    providerId: uuid,
    area_id: uuid,
    areaId: uuid,
    storageLocationId: uuid,
    createdBy: uuid,
    type: { type: 'string', minLength: 1, maxLength: 100 },
    transactionTypeId: uuid,
    order_id: uuid,
    date_from: { type: 'string', minLength: 10, maxLength: 40 },
    date_to: { type: 'string', minLength: 10, maxLength: 40 },
    dateFrom: { type: 'string', minLength: 10, maxLength: 40 },
    dateTo: { type: 'string', minLength: 10, maxLength: 40 },
  },
);

export const stockAdjustmentCreateSchema: FastifySchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: [
      'supply_id',
      'provider_id',
      'area_id',
    ],
    properties: {
      supply_id: uuid,
      provider_id: uuid,
      area_id: uuid,
      location_ids: locationIds,
      type: { type: 'string', enum: [...STOCK_ADJUSTMENT_TYPES] },
      transaction_type_id: uuid,
      transaction_type_code: {
        type: 'string',
        enum: [...STOCK_ADJUSTMENT_TYPES],
      },
      adjustment_reason_id: uuid,
      quantity: { type: 'integer', minimum: 1 },
      stack_quantity: { type: 'integer', minimum: 1 },
      set_per_qty: { type: 'integer', minimum: 1 },
      reason: { type: 'string', minLength: 1, maxLength: 2000 },
      reason_note: { type: 'string', minLength: 1, maxLength: 2000 },
      note: {
        anyOf: [
          { type: 'string', maxLength: 2000 },
          { type: 'null' },
        ],
      },
    },
    anyOf: [
      { required: ['transaction_type_id'] },
      { required: ['transaction_type_code'] },
      { required: ['type'] },
    ],
  },
};
