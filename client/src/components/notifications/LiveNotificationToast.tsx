import type { NotificationLiveSignal } from '../../types/notifications';
import { getButtonClassName } from '../common/Button';
import { APP_LAYER } from '../../constants/layers';

interface LiveNotificationToastProps {
  notification: NotificationLiveSignal | null;
  onDismiss: () => void;
}

export const LiveNotificationToast = ({
  notification,
  onDismiss,
}: LiveNotificationToastProps) => {
  if (!notification) return null;
  return (
    <aside
      role="status"
      aria-live="polite"
      className="fixed right-4 top-4 w-[min(380px,calc(100vw-2rem))] rounded-2xl border border-blue-200 bg-white p-4 shadow-2xl"
      style={{ zIndex: APP_LAYER.toast }}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <i className="hgi-stroke hgi-notification-01 text-xl" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900">{notification.title}</p>
          <p className="mt-1 text-sm leading-5 text-slate-600">{notification.message}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className={getButtonClassName({ variant: 'icon', size: 'icon', className: '-mr-2 -mt-2' })}
          aria-label="Đóng thông báo realtime"
        >
          <i className="hgi-stroke hgi-cancel-01 text-lg" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
};
