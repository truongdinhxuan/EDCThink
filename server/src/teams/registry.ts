import {
  buildOrderStatusHtml,
  buildTestHtml,
  type OrderStatusSnapshot,
} from './orderStatusTemplate';

export interface TeamsRenderContext {
  appBaseUrl: string;
}

/**
 * One entry per app function that posts to its own Teams Workflow. Adding a
 * function is one entry here plus one place that enqueues its event; the
 * tables need no change.
 */
export interface TeamsFunctionDefinition {
  code: string;
  name: string;
  description: string;
  buildHtml: (snapshot: unknown, context: TeamsRenderContext) => string;
  buildTestHtml: (context: TeamsRenderContext) => string;
}

export const TEAMS_FUNCTIONS = {
  ORDER_STATUS_CHANGED: {
    code: 'ORDER_STATUS_CHANGED',
    name: 'Đơn hàng cập nhật trạng thái',
    description: 'Gửi 1 tin mỗi khi đơn đổi trạng thái, kể cả lúc tạo đơn.',
    buildHtml: (snapshot, context) =>
      buildOrderStatusHtml(snapshot as OrderStatusSnapshot, context),
    buildTestHtml: () => buildTestHtml('Đơn hàng cập nhật trạng thái'),
  },
} as const satisfies Record<string, TeamsFunctionDefinition>;

export type TeamsFunctionCode = keyof typeof TEAMS_FUNCTIONS;

export const TEAMS_FUNCTION_CODES = Object.keys(TEAMS_FUNCTIONS) as TeamsFunctionCode[];

export const isTeamsFunctionCode = (value: unknown): value is TeamsFunctionCode =>
  typeof value === 'string' && Object.hasOwn(TEAMS_FUNCTIONS, value);

export const getTeamsFunction = (code: string): TeamsFunctionDefinition | null =>
  isTeamsFunctionCode(code) ? TEAMS_FUNCTIONS[code] : null;

/** Teams accepts about 28 KB per message; stay clear of it. */
export const MAX_PAYLOAD_BYTES = 25 * 1024;
