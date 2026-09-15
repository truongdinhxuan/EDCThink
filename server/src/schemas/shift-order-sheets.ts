import { createListQuerySchema } from './pagination';

const uuid = { type: 'string', format: 'uuid' } as const;

export const SHIFT_ORDER_SHEET_SORT_FIELDS = [
  'work_date',
  'created_at',
  'updated_at',
] as const;

export const shiftOrderSheetListSchema = createListQuerySchema(
  SHIFT_ORDER_SHEET_SORT_FIELDS,
  {
    workDate: { type: 'string', format: 'date' },
    workShiftId: uuid,
    leaderId: uuid,
    areaId: uuid,
    statusId: uuid,
    categoryId: uuid,
  },
);

export const shiftOrderSheetDetailSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: uuid },
  },
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      search: { type: 'string', maxLength: 100 },
      statusId: uuid,
      categoryId: uuid,
    },
  },
};

export const shiftOrderSheetIncomingSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    required: ['workDate', 'workShiftId'],
    properties: {
      workDate: { type: 'string', format: 'date' },
      workShiftId: uuid,
    },
  },
};

export const shiftOrderSheetCurrentSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
  },
};

export const shiftOrderSheetExportSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: uuid },
  },
  produces: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
};
