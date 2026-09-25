import type { FastifySchema } from 'fastify';
import { createListQuerySchema } from './pagination';
import { TEAMS_FUNCTION_CODES } from '../teams/registry';

const uuid = { type: 'string', format: 'uuid' } as const;

const functionCodeParams = {
  type: 'object',
  additionalProperties: false,
  required: ['function_code'],
  properties: { function_code: { type: 'string', enum: [...TEAMS_FUNCTION_CODES] } },
} as const;

export const TEAMS_DELIVERY_SORT_FIELDS = ['created_at', 'status', 'attempts'] as const;

export const teamsWorkflowSaveSchema: FastifySchema = {
  params: functionCodeParams,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['is_active'],
    // No URL here: it is configured in the server env (TEAMS_WEBHOOK_URL_<CODE>).
    properties: {
      is_active: { type: 'boolean' },
      name: { type: 'string', minLength: 1, maxLength: 200 },
    },
  },
};

export const teamsWorkflowTestSchema: FastifySchema = { params: functionCodeParams };

export const teamsDeliveryListSchema = createListQuerySchema(TEAMS_DELIVERY_SORT_FIELDS, {
  functionCode: { type: 'string', enum: [...TEAMS_FUNCTION_CODES] },
  status: { type: 'string', enum: ['PENDING', 'SENT', 'FAILED'] },
  orderCode: { type: 'string', minLength: 1, maxLength: 100 },
});

export const teamsDeliveryRetrySchema: FastifySchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: uuid },
  },
};
