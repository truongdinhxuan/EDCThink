import { createPortal } from 'react-dom';
import type { MouseEvent, ReactNode } from 'react';
import {useEffect} from 'react';
import type { CrudFeedback } from '../../hooks/useCrudResource';
import { AnimatePresence, motion } from 'motion/react';
import { AppTooltip } from '../common/AppTooltip';
import {
  getButtonClassName,
  InfoButton,
  SecondaryButton,
  TextButton,
} from '../common/Button';
import { ActionMenu, type ActionMenuItem } from '../common/ActionMenu';
import { APP_LAYER } from '../../constants/layers';
export const inputClassName =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs outline-none transition sm:text-sm ' +
  'focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500';

export const labelClassName =
  'block space-y-1.5 text-sm font-semibold text-slate-700';

const renderPortal = (children: ReactNode) => {
  if (typeof document === 'undefined') return null;

  return createPortal(children, document.body);
};

export const CrudPageHeader = ({
  title,
  onCreate,
  createLabel = 'Thêm mới',
}: {
  title: string;
  onCreate?: (event: MouseEvent<HTMLButtonElement>) => void;
  createLabel?: string;
}) => (
  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
    <div className="min-w-0">

      <h1 className="mt-1 break-words text-2xl font-bold text-slate-900">
        {title}
      </h1>
    </div>

    {onCreate && (
      <button
        type="button"
        onClick={onCreate}
        className={InfoButton}
      >
        {createLabel}
      </button>
    )}
  </div>
);

export const CrudFeedbackToast = ({
  feedback,
  onClose,
}: {
  feedback: CrudFeedback | null;
  onClose: () => void;
}) => {
  useEffect(() => {
    if (!feedback) return;

    const timeout = window.setTimeout(onClose, 3000);

    return () => window.clearTimeout(timeout);
  }, [feedback, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {feedback && (
        <motion.div
          key={`${feedback.type}-${feedback.message}`}
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: -24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.97 }}
          transition={{
            duration: 0.25,
            ease: 'easeOut',
          }}
          className={`fixed inset-x-0 top-0 flex w-full items-start justify-between gap-3 border-b px-4 py-3 text-sm shadow-xl
            md:inset-x-auto md:right-6 md:top-6 md:w-auto md:max-w-md md:rounded-xl md:border
            ${
              feedback.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-rose-200 bg-rose-50 text-rose-800'
            }`}
          style={{ zIndex: APP_LAYER.toast }}
        >
          <span className="min-w-0 flex-1 break-words font-medium">
            {feedback.message}
          </span>

          <AppTooltip content="Đóng thông báo" side="left">
            <button
              type="button"
              onClick={onClose}
              className={getButtonClassName({
                variant: 'icon',
                size: 'xs',
                className: 'shrink-0 text-lg font-bold leading-none opacity-70 hover:opacity-100',
              })}
              aria-label="Đóng thông báo"
            >
              <span aria-hidden="true">×</span>
            </button>
          </AppTooltip>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export const ErrorState = ({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) => (
  <div
    role="alert"
    className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center sm:p-8"
  >
    <p className="break-words text-sm font-semibold text-rose-700">
      {message}
    </p>

    <button
      type="button"
      onClick={onRetry}
      className={`${TextButton} mt-3`}
    >
      Thử lại
    </button>
  </div>
);

export const EmptyState = ({ label }: { label: string }) => (
  <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500 sm:p-10">
    {label}
  </div>
);

export const CrudModal = ({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) =>
  renderPortal(
    <div
      className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-3 backdrop-blur-sm sm:p-4"
      style={{ zIndex: APP_LAYER.primaryDrawer }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="crud-modal-title"
        className="my-auto max-h-[calc(100vh-1.5rem)] max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl sm:max-h-[90vh] sm:max-h-[90dvh]"
      >
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-5">
          <h2
            id="crud-modal-title"
            className="min-w-0 break-words text-lg font-bold text-slate-900"
          >
            {title}
          </h2>

          {/* <AppTooltip content="Đóng cửa sổ" side="left" disabled={busy}>
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className={getButtonClassName({
                variant: 'icon',
                size: 'sm',
                className: 'shrink-0 text-xl text-slate-400',
              })}
              aria-label="Đóng cửa sổ"
            >
              <span aria-hidden="true">×</span>
            </button>
          </AppTooltip> */}
        </div>

        <div className="max-h-[calc(100vh-6rem)] overflow-y-auto p-4 sm:max-h-[calc(90vh-4.5rem)] sm:p-5">
          {children}
        </div>
      </div>
    </div>,
  );

export const StatusBadge = ({ active }: { active: boolean }) => (
  <span
    className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${
      active
        ? 'bg-emerald-50 text-emerald-700'
        : 'bg-slate-100 text-slate-500'
    }`}
  >
    {active ? 'Active' : 'Inactive'}
  </span>
);

export const RowActions = ({
  onView,
  onEdit,
  onDelete,
  deleteLabel = 'Deactivate',
  ariaLabel,
  extraItems = [],
}: {
  onView?: (trigger: HTMLElement | null) => void;
  onEdit?: (trigger: HTMLElement | null) => void;
  onDelete?: (trigger: HTMLElement | null) => void;
  deleteLabel?: string;
  ariaLabel?: string;
  /**
   * Page-specific actions such as Permissions or Area Types. They lead the menu:
   * they are why someone opens it on this page, while Xem and Sửa are the same
   * everywhere and are found by habit further down.
   */
  extraItems?: ActionMenuItem[];
}) => {
  const items: ActionMenuItem[] = extraItems.map((item) => ({ ...item, primary: true }));
  if (onView) items.push({ label: 'Xem', onSelect: onView });
  if (onEdit) items.push({ label: 'Sửa', onSelect: onEdit });
  if (onDelete) items.push({ label: deleteLabel, onSelect: onDelete, danger: true });

  return <ActionMenu items={items} ariaLabel={ariaLabel} />;
};

export const FormActions = ({
  busy,
  onCancel,
  submitLabel,
}: {
  busy: boolean;
  onCancel: () => void;
  submitLabel: string;
}) => (
  <div className="mt-5 flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
    <button
      type="button"
      disabled={busy}
      onClick={onCancel}
      className={`${SecondaryButton} w-full sm:w-auto`}
    >
      Bỏ qua
    </button>

    <button
      type="submit"
      disabled={busy}
      className={`${InfoButton} w-full sm:w-auto`}
    >
      {busy ? 'Đang lưu...' : submitLabel}
    </button>
  </div>
);

export const FieldError = ({ message }: { message?: string }) =>
  message ? (
    <p role="alert" className="text-xs font-medium text-rose-600">
      {message}
    </p>
  ) : null;
