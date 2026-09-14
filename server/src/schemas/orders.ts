import { createListQuerySchema } from './pagination';

const uuid = { type: 'string', format: 'uuid' } as const;

const orderItemProperties = {
  supply_id: uuid,
  provider_id: uuid,
  unit_id: uuid,
  quantity_requested: { type: 'number', exclusiveMinimum: 0 },
  set_per_qty: { type: 'number', exclusiveMinimum: 0 },
  requested_stack_quantity: { type: 'number', exclusiveMinimum: 0 },
  requested_total_set_quantity: { type: 'number', exclusiveMinimum: 0 },
  note: {
    anyOf: [
      { type: 'string', maxLength: 2000 },
      { type: 'null' },
    ],
  },
} as const;

const orderItems = {
  type: 'array',
  minItems: 1,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['supply_id', 'provider_id', 'quantity_requested'],
    properties: orderItemProperties,
  },
} as const;

export const orderCreateSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['from_area_id', 'to_area_id', 'order_list'],
    properties: {
      from_area_id: uuid,
      to_area_id: uuid,
      shift_order_sheet_id: uuid,
      note: { type: 'string', maxLength: 2000 },
      order_list: orderItems,
    },
  },
};

export const orderPatchSchema = {
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
    properties: {
      note: { type: 'string', maxLength: 2000 },
    },
  },
};

export const orderApproveSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: uuid },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['order_item_id', 'quantity_approved'],
          properties: {
            order_item_id: uuid,
            quantity_approved: { type: 'number', minimum: 0 },
          },
        },
      },
      note: { type: 'string', maxLength: 2000 },
    },
  },
};

export const allocationConfirmSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'allocationId'],
    properties: { id: uuid, allocationId: uuid },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['actual_stack_quantity'],
    properties: {
      actual_stack_quantity: { type: 'number', minimum: 0 },
      reason: { type: 'string', maxLength: 2000 },
    },
  },
};

export const orderIssueSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: uuid },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['order_item_id', 'issues'],
          properties: {
            order_item_id: uuid,
            issues: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['storage_location_id', 'quantity'],
                properties: {
                  storage_location_id: uuid,
                  quantity: { type: 'number', exclusiveMinimum: 0 },
                },
              },
            },
          },
        },
      },
      forklift_by: uuid,
      taken_away_by: uuid,
    },
  },
};

export const ORDER_SORT_FIELDS = [
  'id', 'code', 'status', 'status_id', 'created_at', 'updated_at', 'submitted_at',
  'approved_at', 'received_at',
] as const;

export const orderListSchema = createListQuerySchema(ORDER_SORT_FIELDS, {
  status: { type: 'string', minLength: 1, maxLength: 100 },
  from_area_id: uuid,
  to_area_id: uuid,
  date: { type: 'string', minLength: 10, maxLength: 10 },
  createdBy: uuid,
  areaId: uuid,
  workShiftId: {
    ...uuid,
    description: 'Filter Orders by historical Work Shift linked through Shift Order Sheet.',
  },
  dateFrom: { type: 'string', minLength: 10, maxLength: 40 },
  dateTo: { type: 'string', minLength: 10, maxLength: 40 },
});
