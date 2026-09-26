import type { FastifySchema } from 'fastify';

const codeParams = {
  type: 'object',
  additionalProperties: false,
  required: ['code'],
  properties: { code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]*$', maxLength: 100 } },
} as const;

export const teamsWebhookUpdateSchema: FastifySchema = {
  params: codeParams,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['is_active'],
    // The URL has its own write-only endpoint (PUT /:code/url).
    properties: { is_active: { type: 'boolean' } },
  },
};

/** Write-only: stored in Vault, never returned. */
export const teamsWebhookUrlSchema: FastifySchema = {
  params: codeParams,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['webhook_url'],
    properties: { webhook_url: { type: 'string', minLength: 1, maxLength: 2048 } },
  },
};

export const teamsWebhookTestSchema: FastifySchema = { params: codeParams };
