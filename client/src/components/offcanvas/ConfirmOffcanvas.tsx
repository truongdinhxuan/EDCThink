import { useRef, useState, type RefObject } from 'react';
import type {
  ConfirmDrawerEntry,
  OffcanvasCloseReason,
} from '../../types/offcanvas.types';
import {
  ErrorButton,
  InfoButton,
  SecondaryButton,
  WarningButton,
} from '../common/Button';
import { Offcanvas } from './Offcanvas';

const buttonClassByVariant = {
  default: InfoButton,
  warning: WarningButton,
  danger: ErrorButton,
} as const;

export const ConfirmOffcanvas = ({
  entry,
  panelRef,
  onRequestClose,
  onConfirmed,
  onBusyChange,
}: {
  entry: ConfirmDrawerEntry;
  panelRef: RefObject<HTMLDivElement | null>;
  onRequestClose: (reason: OffcanvasCloseReason) => void;
  onConfirmed: () => void;
  onBusyChange: (busy: boolean) => void;
}) => {
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const busy = Boolean(entry.isBusy || pending);

  const confirm = async () => {
    if (busy || pendingRef.current) return;
    pendingRef.current = true;
    setError(null);
    setPending(true);
    onBusyChange(true);
    try {
      const result = await entry.onConfirm();
      if (result !== false) onConfirmed();
    } catch (confirmationError) {
      setError(
        confirmationError instanceof Error && confirmationError.message.trim()
          ? confirmationError.message
          : 'Không thể hoàn thành thao tác. Vui lòng thử lại.',
      );
    } finally {
      pendingRef.current = false;
      onBusyChange(false);
      setPending(false);
    }
  };

  const cancel = () => {
    if (busy && entry.preventCloseWhileBusy) return;
    onRequestClose('cancel');
  };

  const footer = (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <button
        type="button"
        data-confirm-cancel="true"
        disabled={busy}
        onClick={cancel}
        className={`${SecondaryButton} min-h-9 w-full px-4 text-sm sm:min-h-10 sm:w-auto`}
      >
        {entry.cancelLabel ?? 'Bỏ qua'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void confirm()}
        className={`${buttonClassByVariant[entry.variant ?? 'default']} min-h-9 w-full px-4 text-sm sm:min-h-10 sm:w-auto`}
      >
        {pending ? 'Đang xử lý...' : entry.confirmLabel ?? 'Xác nhận'}
      </button>
    </div>
  );

  return (
    <Offcanvas
      id={entry.id}
      phase={entry.phase}
      layer="confirmation"
      role="alertdialog"
      title={entry.title}
      description={entry.description}
      footer={footer}
      size={entry.size ?? 'sm'}
      isTopmost
      busy={Boolean(busy && entry.preventCloseWhileBusy)}
      panelRef={panelRef}
      onRequestClose={onRequestClose}
    >
      <div className="space-y-4">
        {entry.content}
        {error && (
          <div role="alert" className="break-words rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-700">
            {error}
          </div>
        )}
      </div>
    </Offcanvas>
  );
};
