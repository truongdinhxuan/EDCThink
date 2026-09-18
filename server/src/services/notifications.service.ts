import type { FastifyInstance } from 'fastify';
import { canReadOrder } from '../domain/order-access';
import type { OrderReadAccess } from '../domain/order-access';
import {
  NOTIFICATION_DOMAIN,
  NOTIFICATION_TYPE,
  type NotificationListItem,
  type NotificationListQuery,
  type NotificationLiveSignal,
  type NotificationType,
  type StockChangeCursor,
  type SupplyOrderNotificationSource,
} from '../interfaces/notifications';
import { getActiveAuthorizationContexts } from './authorization.service';
import {
  createPaginatedResult,
  parsePagination,
  resolvePaginatedQueryResult,
} from '../utils/pagination';

interface SupabaseErrorLike {
  code?: string;
  message?: string;
}

interface NotificationRelationRow {
  id: string;
  domain: string;
  type: NotificationType;
  title: string;
  message: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
  area: unknown;
  creator: unknown;
}

interface NotificationRecipientRow {
  id: string;
  notification_id: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  notification: NotificationRelationRow | NotificationRelationRow[] | null;
}

interface OrderEntityRow {
  id: string;
  code: string;
  shift_order_sheet_id: string | null;
}

export class NotificationServiceError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'NotificationServiceError';
  }
}

const fail = (statusCode: number, message: string): never => {
  throw new NotificationServiceError(statusCode, message);
};

const databaseError = (error: SupabaseErrorLike | null, fallback: string): never => {
  void error;
  return fail(500, fallback);
};

const firstRelation = <T>(value: T | T[] | null): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : value;

const requireRelation = <T>(value: T | null, message: string): T => {
  if (!value) return fail(500, message);
  return value;
};

const normalizeBoolean = (
  value: boolean | string | undefined,
  field: string,
): boolean | undefined => {
  if (value === undefined || value === '') return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  fail(400, `${field} chỉ nhận true hoặc false`);
};

const displayName = (user: {
  first_name?: string | null;
  last_name?: string | null;
  vinfast_id?: string | null;
} | null): string => {
  if (!user) return '';
  const name = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
  return name || (user.vinfast_id === null || user.vinfast_id === undefined
    ? ''
    : String(user.vinfast_id));
};

const NOTIFICATION_SELECT = `
  id, notification_id, is_read, read_at, created_at,
  notification:notifications!notification_recipients_notification_id_fkey!inner(
    id, domain, type, title, message, entity_type, entity_id, created_at,
    is_active, is_deleted,
    area:areas!notifications_area_id_fkey(id, code, name),
    creator:users!notifications_created_by_fkey(
      id, vinfast_id, first_name, last_name
    )
  )
`;

export class NotificationsService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get db() {
    return this.fastify.supabaseAdmin;
  }

  async resolveOrderRecipients(
    order: Pick<SupplyOrderNotificationSource, 'to_area_id'>,
    actorId: string,
  ): Promise<string[]> {
    const contexts = await getActiveAuthorizationContexts(this.fastify);
    return [...new Set(contexts
      .filter((candidate) => candidate.userId !== actorId)
      .filter((candidate) => canReadOrder(candidate, order))
      .map((candidate) => candidate.userId))];
  }

  async persistOrderCreated(
    actor: OrderReadAccess & { id: string },
    order: SupplyOrderNotificationSource,
  ): Promise<string | null> {
    const recipientIds = await this.resolveOrderRecipients(order, actor.id);
    if (recipientIds.length === 0) return null;

    const statusLabel = order.status_lookup.name || order.status_lookup.code;
    const { data, error } = await this.db.rpc('persist_notification_with_recipients', {
      p_domain: NOTIFICATION_DOMAIN.SUPPLY,
      p_type: NOTIFICATION_TYPE.ORDER_CREATED,
      p_title: 'Order mới',
      p_message: `Order ${order.code} đã được gửi và chuyển sang ${statusLabel}.`,
      p_entity_type: 'order',
      p_entity_id: order.id,
      p_area_id: order.to_area_id,
      p_created_by: actor.id,
      p_event_key: [
        NOTIFICATION_DOMAIN.SUPPLY,
        'order',
        order.id,
        'created',
        order.status_id,
        order.updated_at,
      ].join(':'),
      p_recipient_ids: recipientIds,
    });
    if (error) databaseError(error, 'Không thể lưu thông báo Order');
    return typeof data === 'string' ? data : null;
  }

  async persistOrderTransition(
    actor: OrderReadAccess & { id: string },
    previous: SupplyOrderNotificationSource,
    current: SupplyOrderNotificationSource,
    type: NotificationType,
  ): Promise<string | null> {
    if (previous.status_id === current.status_id) return null;
    const recipientIds = await this.resolveOrderRecipients(current, actor.id);
    if (recipientIds.length === 0) return null;

    const statusLabel = current.status_lookup.name || current.status_lookup.code;
    const title = type === NOTIFICATION_TYPE.ORDER_CREATED
      ? 'Order mới'
      : 'Cập nhật Order';
    const message = type === NOTIFICATION_TYPE.ORDER_CREATED
      ? `Order ${current.code} đã được gửi và chuyển sang ${statusLabel}.`
      : `Order ${current.code} đã chuyển sang ${statusLabel}.`;
    const eventKey = [
      NOTIFICATION_DOMAIN.SUPPLY,
      'order',
      current.id,
      previous.status_id,
      current.status_id,
      current.updated_at,
    ].join(':');

    const { data, error } = await this.db.rpc('persist_notification_with_recipients', {
      p_domain: NOTIFICATION_DOMAIN.SUPPLY,
      p_type: type,
      p_title: title,
      p_message: message,
      p_entity_type: 'order',
      p_entity_id: current.id,
      p_area_id: current.to_area_id,
      p_created_by: actor.id,
      p_event_key: eventKey,
      p_recipient_ids: recipientIds,
    });
    if (error) databaseError(error, 'Không thể lưu thông báo Order');
    return typeof data === 'string' ? data : null;
  }

  private applyScope<T>(
    request: T,
    userId: string,
    query: NotificationListQuery,
  ): T {
    let scoped = (request as unknown as {
      eq: (column: string, value: unknown) => unknown;
    }).eq('user_id', userId) as T;
    scoped = (scoped as unknown as { eq: (column: string, value: unknown) => unknown })
      .eq('is_active', true) as T;
    scoped = (scoped as unknown as { eq: (column: string, value: unknown) => unknown })
      .eq('is_deleted', false) as T;
    scoped = (scoped as unknown as { eq: (column: string, value: unknown) => unknown })
      .eq('notification.is_active', true) as T;
    scoped = (scoped as unknown as { eq: (column: string, value: unknown) => unknown })
      .eq('notification.is_deleted', false) as T;
    if (query.domain?.trim()) {
      scoped = (scoped as unknown as { eq: (column: string, value: unknown) => unknown })
        .eq('notification.domain', query.domain.trim()) as T;
    }
    if (normalizeBoolean(query.unreadOnly, 'unreadOnly') === true) {
      scoped = (scoped as unknown as { eq: (column: string, value: unknown) => unknown })
        .eq('is_read', false) as T;
    }
    return scoped;
  }

  async list(userId: string, query: NotificationListQuery = {}) {
    const pagination = parsePagination(query, {
      allowedSortBy: ['created_at'] as const,
      defaultSortBy: 'created_at',
      defaultSortOrder: 'desc',
    });
    let request = this.db
      .from('notification_recipients')
      .select(NOTIFICATION_SELECT, { count: 'exact' });
    request = this.applyScope(request, userId, query);
    request = request
      .order('created_at', { ascending: pagination.sortOrder === 'asc' })
      .order('id', { ascending: pagination.sortOrder === 'asc' });

    const result = await request.range(pagination.from, pagination.to);
    const paginated = resolvePaginatedQueryResult({
      data: result.data,
      error: result.error,
      count: result.count,
    }, pagination);
    if (!paginated) databaseError(result.error, 'Không thể tải thông báo');

    let unreadRequest = this.db
      .from('notification_recipients')
      .select(`
        id,
        notification:notifications!notification_recipients_notification_id_fkey!inner(
          id, domain, is_active, is_deleted
        )
      `, { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_active', true)
      .eq('is_deleted', false)
      .eq('is_read', false)
      .eq('notification.is_active', true)
      .eq('notification.is_deleted', false);
    if (query.domain?.trim()) {
      unreadRequest = unreadRequest.eq('notification.domain', query.domain.trim());
    }
    const { count: unreadCount, error: unreadError } = await unreadRequest;
    if (unreadError) databaseError(unreadError, 'Không thể đếm thông báo chưa đọc');

    const rows = paginated!.items as unknown as NotificationRecipientRow[];
    const orderIds = [...new Set(rows
      .map((row) => firstRelation(row.notification))
      .filter((notification): notification is NotificationRelationRow =>
        notification?.entity_type === 'order')
      .map((notification) => notification.entity_id))];
    const orderById = new Map<string, OrderEntityRow>();
    if (orderIds.length > 0) {
      const { data, error } = await this.db
        .from('orders')
        .select('id, code, shift_order_sheet_id')
        .in('id', orderIds);
      if (error) databaseError(error, 'Không thể tải Order của thông báo');
      for (const order of (data ?? []) as OrderEntityRow[]) orderById.set(order.id, order);
    }

    const items: NotificationListItem[] = rows.map((row) => {
      const notification = requireRelation(
        firstRelation(row.notification),
        'Dữ liệu thông báo không hợp lệ',
      );
      const area = firstRelation(notification.area as {
        id: string; code: string; name: string;
      } | Array<{ id: string; code: string; name: string }> | null);
      const creator = firstRelation(notification.creator as {
        id: string; vinfast_id: string; first_name: string; last_name: string;
      } | Array<{
        id: string; vinfast_id: string; first_name: string; last_name: string;
      }> | null);
      const entity = notification.entity_type === 'order'
        ? orderById.get(notification.entity_id) ?? null
        : null;
      return {
        id: notification.id,
        type: notification.type,
        domain: notification.domain,
        title: notification.title,
        message: notification.message,
        entity_type: notification.entity_type,
        entity,
        area,
        created_by: creator ? { id: creator.id, display_name: displayName(creator) } : null,
        created_at: notification.created_at,
        is_read: row.is_read,
        read_at: row.read_at,
      };
    });

    return {
      ...createPaginatedResult(items, pagination, paginated!.pagination.total),
      unreadCount: unreadCount ?? 0,
    };
  }

  async markRead(userId: string, notificationId: string) {
    const { data: existing, error: findError } = await this.db
      .from('notification_recipients')
      .select('notification_id, is_read, read_at')
      .eq('notification_id', notificationId)
      .eq('user_id', userId)
      .eq('is_active', true)
      .eq('is_deleted', false)
      .maybeSingle();
    if (findError) databaseError(findError, 'Không thể kiểm tra thông báo');
    if (!existing) return fail(404, 'Không tìm thấy thông báo');
    if (existing.is_read) return existing;

    const readAt = new Date().toISOString();
    const { data, error } = await this.db
      .from('notification_recipients')
      .update({ is_read: true, read_at: readAt })
      .eq('notification_id', notificationId)
      .eq('user_id', userId)
      .eq('is_read', false)
      .select('notification_id, is_read, read_at')
      .single();
    if (error || !data) databaseError(error, 'Không thể đánh dấu đã đọc');
    return data;
  }

  async listLiveSignals(
    userId: string,
    cursorCreatedAt: string,
    cursorId: string,
  ): Promise<NotificationLiveSignal[]> {
    const { data, error } = await this.db
      .from('notification_recipients')
      .select(NOTIFICATION_SELECT)
      .eq('user_id', userId)
      .eq('is_active', true)
      .eq('is_deleted', false)
      .eq('notification.is_active', true)
      .eq('notification.is_deleted', false)
      .gte('created_at', cursorCreatedAt)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(100);
    if (error) databaseError(error, 'Không thể đồng bộ realtime thông báo');

    const rows = ((data ?? []) as unknown as NotificationRecipientRow[])
      .filter((row) => row.created_at > cursorCreatedAt
        || (row.created_at === cursorCreatedAt && row.id > cursorId));
    const orderIds = [...new Set(rows
      .map((row) => firstRelation(row.notification))
      .filter((notification): notification is NotificationRelationRow =>
        notification?.entity_type === 'order')
      .map((notification) => notification.entity_id))];
    const sheetByOrderId = new Map<string, string | null>();
    if (orderIds.length > 0) {
      const { data: orders, error: orderError } = await this.db
        .from('orders')
        .select('id, shift_order_sheet_id')
        .in('id', orderIds);
      if (orderError) databaseError(orderError, 'Không thể đồng bộ Order realtime');
      for (const order of orders ?? []) {
        sheetByOrderId.set(order.id, order.shift_order_sheet_id as string | null);
      }
    }
    return rows.map((row) => {
      const notification = requireRelation(
        firstRelation(row.notification),
        'Dữ liệu realtime không hợp lệ',
      );
      return {
        cursor_id: row.id,
        notification_id: notification.id,
        type: notification.type,
        domain: notification.domain,
        entity_type: notification.entity_type,
        entity_id: notification.entity_id,
        shift_order_sheet_id: sheetByOrderId.get(notification.entity_id) ?? null,
        title: notification.title,
        message: notification.message,
        created_at: row.created_at,
      };
    });
  }

  async getLatestStockChange(
    cursorCreatedAt: string,
    cursorId: string,
  ): Promise<StockChangeCursor | null> {
    const { data, error } = await this.db
      .from('stock_transactions')
      .select('id, created_at')
      .eq('is_active', true)
      .eq('is_deleted', false)
      .gte('created_at', cursorCreatedAt)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(100);
    if (error) databaseError(error, 'Không thể đồng bộ thay đổi tồn kho');

    const rows = ((data ?? []) as Array<{ id: string; created_at: string }>)
      .filter((row) => row.created_at > cursorCreatedAt
        || (row.created_at === cursorCreatedAt && row.id > cursorId))
      .map((row) => ({
        cursor_id: row.id,
        created_at: row.created_at,
      }));
    return rows.at(-1) ?? null;
  }
}
