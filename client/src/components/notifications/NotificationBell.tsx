import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { RefObject } from 'react';
import {
  listNotifications,
  markNotificationRead,
} from '../../api/notifications.service';
import { getApiErrorMessage } from '../../api/errors';
import { getButtonClassName, IconButton } from '../common/Button';
import { AppTooltip } from '../common/AppTooltip';
import { getWorkspacePath } from '../../constants/workspaces';
import { useAuth } from '../../context/AuthContext';
import { queryKeys } from '../../lib/queryKeys';
import { NOTIFICATION_DOMAIN, type AppNotification } from '../../types/notifications';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBell, faXmark } from '@fortawesome/free-solid-svg-icons';
import { APP_LAYER } from '../../constants/layers';
interface NotificationBellProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  containerRef: RefObject<HTMLDivElement | null>;
}

const query = {
  page: 1,
  pageSize: 10,
  domain: NOTIFICATION_DOMAIN.SUPPLY,
  sortBy: 'created_at',
  sortOrder: 'desc' as const,
};

const formatNotificationTime = (value: string): string => new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Ho_Chi_Minh',
}).format(new Date(value));

const NotificationBell = ({ isOpen, setIsOpen, containerRef }: NotificationBellProps) => {
  const { role } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const notificationsQuery = useQuery({
    queryKey: queryKeys.notifications.list(query),
    queryFn: ({ signal }) => listNotifications(query, signal),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const markReadMutation = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all }),
  });
  const unreadCount = notificationsQuery.data?.unread_count ?? 0;

  const openNotification = async (notification: AppNotification) => {
    if (!notification.is_read) {
      try {
        await markReadMutation.mutateAsync(notification.id);
      } catch {
        return;
      }
    }
    setIsOpen(false);
    if (notification.entity_type === 'order' && notification.entity) {
      navigate(`${getWorkspacePath(role, 'orders')}/${notification.entity.id}`);
    }
  };

  return (
    <div ref={containerRef}>
      <AppTooltip content="Thông báo" side="bottom">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`${IconButton} relative`}
          aria-label={unreadCount > 0 ? `Thông báo, ${unreadCount} chưa đọc` : 'Thông báo'}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
        >
          {unreadCount > 0 && (
            <span
              className="absolute right-0 top-0 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-4 text-white ring-2 ring-white"
              aria-hidden="true"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
          <FontAwesomeIcon icon={faBell} className="text-2xl hover:cursor-pointer" aria-hidden="true" />
        </button>
      </AppTooltip>

      {isOpen && (
        <section
          className="fixed left-3 right-3 top-[4.75rem] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-3 sm:w-[min(360px,calc(100vw-2rem))]"
          style={{ zIndex: APP_LAYER.dropdown }}
          aria-label="Danh sách thông báo"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <h3 className="font-bold text-slate-800">Thông báo</h3>
              <p className="text-xs text-slate-500">{unreadCount} thông báo chưa đọc</p>
            </div>
            <button
              type="button"
              className={getButtonClassName({ variant: 'icon', size: 'icon' })}
              onClick={() => setIsOpen(false)}
              aria-label="Đóng thông báo"
            >
              <FontAwesomeIcon icon={faXmark} className="text-lg hover:cursor-pointer" aria-hidden="true" />
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto overscroll-contain p-2">
            {notificationsQuery.isPending && (
              <div role="status" aria-label="Đang tải thông báo" className="space-y-2 p-2">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="animate-pulse rounded-xl bg-slate-50 p-3 motion-reduce:animate-none">
                    <div className="h-4 w-2/3 rounded bg-slate-200" />
                    <div className="mt-2 h-3 w-full rounded bg-slate-200" />
                    <div className="mt-2 h-3 w-1/3 rounded bg-slate-200" />
                  </div>
                ))}
              </div>
            )}
            {notificationsQuery.isError && (
              <div className="p-4 text-center text-sm text-rose-600" role="alert">
                <p>{getApiErrorMessage(notificationsQuery.error, 'Không thể tải thông báo.')}</p>
                <button
                  type="button"
                  className={getButtonClassName({ variant: 'text', size: 'sm', className: 'mt-2' })}
                  onClick={() => void notificationsQuery.refetch()}
                >
                  Thử lại
                </button>
              </div>
            )}
            {!notificationsQuery.isPending
              && !notificationsQuery.isError
              && (notificationsQuery.data?.data.length ?? 0) === 0 && (
                <p className="p-6 text-center text-sm text-slate-500">Chưa có thông báo.</p>
              )}
            {notificationsQuery.data?.data.map((notification) => (
              <button
                key={notification.id}
                type="button"
                onClick={() => void openNotification(notification)}
                disabled={markReadMutation.isPending}
                className={`mb-1 block w-full rounded-xl p-3 text-left transition-colors last:mb-0 ${
                  notification.is_read ? 'bg-white hover:bg-slate-50' : 'bg-blue-50 hover:bg-blue-100'
                }`}
              >
                <span className="hover:cursor-pointer flex items-start gap-3">
                  <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                    notification.is_read ? 'bg-slate-300' : 'bg-blue-600'
                  }`} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-800">{notification.title}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-slate-600">{notification.message}</span>
                    <span className="mt-1.5 block text-[11px] text-slate-400">
                      {notification.created_by?.display_name
                        ? `${notification.created_by.display_name} · `
                        : ''}
                      {formatNotificationTime(notification.created_at)}
                    </span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default NotificationBell;
