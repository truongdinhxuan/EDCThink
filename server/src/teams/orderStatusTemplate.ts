import { escapeHtml, formatTeamsDateTime } from './html';

/**
 * What get_order_status_teams_event(revision_id) returns: status, actor and
 * time of that revision, plus the Order and its items as they are when read.
 */
export interface OrderStatusSnapshot {
  order: {
    id: string;
    code: string;
    from_area: { code: string | null; name: string | null } | null;
    to_area: { code: string | null; name: string | null } | null;
    requester: string | null;
    rejected_reason: string | null;
    cancel_reason: string | null;
  };
  revision_id: string;
  occurred_at: string;
  actor: string | null;
  old_status: { code: string; name: string } | null;
  new_status: { code: string; name: string };
  items: Array<{
    name: string | null;
    unit: string | null;
    quantity_requested: number | string | null;
    quantity_approved: number | string | null;
    quantity_issued: number | string | null;
  }>;
}

export const MAX_ITEM_ROWS = 20;

/** Teams-palette colour per order_statuses.code (codes read from the live table). */
export const ORDER_STATUS_COLORS: Readonly<Record<string, string>> = {
  PENDING: '#d13438',
  APPROVED: '#0078d4',
  PARTIAL_ISSUED: '#ca5010',
  ISSUED: '#ca5010',
  // Still in progress: completion is a separate, later status.
  RECEIVED: '#ca5010',
  COMPLETED: '#107c10',
  REJECTED: '#605e5c',
  CANCELLED: '#605e5c',
};
const FALLBACK_COLOR = '#605e5c';

type OrderItemSnapshot = OrderStatusSnapshot['items'][number];

/**
 * Which quantity the table shows: what was asked while waiting, what was
 * approved after review, what left once issuing started. A cancelled Order
 * shows the approved count when it got that far.
 */
export const shownQuantity = (statusCode: string, item: OrderItemSnapshot) => {
  switch (statusCode) {
    case 'APPROVED':
      return item.quantity_approved;
    case 'PARTIAL_ISSUED':
    case 'ISSUED':
    case 'RECEIVED':
    case 'COMPLETED':
      return item.quantity_issued;
    case 'CANCELLED':
      return item.quantity_approved ?? item.quantity_requested;
    default:
      return item.quantity_requested;
  }
};

const quantityFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const formatQuantity = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? quantityFormatter.format(number) : '—';
};

const areaLabel = (area: { code: string | null; name: string | null } | null): string =>
  area?.name?.trim() || area?.code?.trim() || '—';

/**
 * Caps free text so 20 rows plus a reason can never pass the payload limit
 * (MAX_PAYLOAD_BYTES), however long a supply name or reason is.
 */
const clip = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

export const orderDetailUrl = (appBaseUrl: string, orderId: string): string =>
  `${appBaseUrl.replace(/\/+$/, '')}/workspace/orders/${encodeURIComponent(orderId)}`;

export const buildOrderStatusHtml = (
  snapshot: OrderStatusSnapshot,
  options: { appBaseUrl: string },
): string => {
  const status = snapshot.new_status;
  const isNewOrder = status.code === 'PENDING' && snapshot.old_status === null;
  const title = isNewOrder ? '🔔 Thông báo đơn hàng mới' : '🔄 Đơn hàng cập nhật trạng thái';
  const personLabel = isNewOrder ? 'Người tạo' : 'Người thao tác';
  const person = (isNewOrder ? snapshot.order.requester : snapshot.actor) || snapshot.actor || '—';

  const details = [
    `Mã đơn: <b>${escapeHtml(snapshot.order.code)}</b>`,
    `${personLabel}: ${escapeHtml(clip(person, 120))}`,
    `Thời gian: ${escapeHtml(formatTeamsDateTime(snapshot.occurred_at))}`,
    `Khu gửi → khu nhận: ${escapeHtml(areaLabel(snapshot.order.from_area))} → ${escapeHtml(areaLabel(snapshot.order.to_area))}`,
  ];
  if (!isNewOrder) {
    details.push(`Từ: ${escapeHtml(snapshot.old_status?.name ?? '—')} → ${escapeHtml(status.name)}`);
  }

  const shown = snapshot.items.slice(0, MAX_ITEM_ROWS);
  const hidden = snapshot.items.length - shown.length;
  const rows = shown.map((item) =>
    `<tr><td>${escapeHtml(clip(item.name ?? '—', 120))}</td><td>${escapeHtml(formatQuantity(shownQuantity(status.code, item)))}</td><td>${escapeHtml(clip(item.unit ?? '', 30))}</td></tr>`,
  ).join('');
  const more = hidden > 0 ? `<p>+${hidden} vật tư khác</p>` : '';

  const color = ORDER_STATUS_COLORS[status.code] ?? FALLBACK_COLOR;
  const reason = status.code === 'REJECTED'
    ? snapshot.order.rejected_reason
    : status.code === 'CANCELLED'
      ? snapshot.order.cancel_reason
      : null;
  const reasonLine = reason?.trim() ? `<br>Lý do: ${escapeHtml(clip(reason.trim(), 1000))}` : '';

  return [
    `<p><b>${title}</b></p>`,
    `<p>${details.join('<br>')}</p>`,
    `<table><tr><th>Vật tư</th><th>SL</th><th>ĐVT</th></tr>${rows}</table>`,
    more,
    `<p>Trạng thái: <span style='color:${color}'><b>${escapeHtml(status.name)}</b></span>${reasonLine}</p>`,
    `<p><a href='${escapeHtml(orderDetailUrl(options.appBaseUrl, snapshot.order.id))}'>👉 Xem chi tiết</a></p>`,
  ].join('');
};

export const buildTestHtml = (functionName: string, now: Date = new Date()): string => [
  '<p><b>🧪 Tin nhắn thử từ EDCThink</b></p>',
  `<p>Chức năng: <b>${escapeHtml(functionName)}</b><br>Thời gian: ${escapeHtml(formatTeamsDateTime(now))}</p>`,
  '<p>Nếu bạn thấy tin này, Workflow đã nhận được request từ EDCThink.</p>',
].join('');
