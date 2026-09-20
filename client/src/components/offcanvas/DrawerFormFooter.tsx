import type { ReactNode } from 'react';
import { InfoButton, SecondaryButton } from '../common/Button';

interface DrawerFormFooterProps {
  cancelLabel?: string;
  submitLabel?: string;
  submittingLabel?: string;
  isSubmitting?: boolean;
  isDisabled?: boolean;
  formId?: string;
  onCancel: () => void;
  onSubmit?: () => void;
  secondaryAction?: ReactNode;
  showSubmit?: boolean;
  /** Small helper text shown next to the primary action (e.g. a submit shortcut). */
  hint?: ReactNode;
}

export const DrawerFormFooter = ({
  cancelLabel = 'Bỏ qua',
  submitLabel = 'Lưu',
  submittingLabel = 'Đang lưu...',
  isSubmitting = false,
  isDisabled = false,
  formId,
  onCancel,
  onSubmit,
  secondaryAction,
  showSubmit = true,
  hint,
}: DrawerFormFooterProps) => (
  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
    {hint && (
      <span className="text-center text-xs text-slate-400 sm:mr-auto sm:text-left">{hint}</span>
    )}
    {secondaryAction}
    <button
      type="button"
      disabled={isSubmitting}
      onClick={onCancel}
      className={`${SecondaryButton} min-h-9 w-full px-4 text-sm sm:min-h-10 sm:w-auto`}
    >
      {cancelLabel}
    </button>
    {showSubmit && (
      <button
        type={formId ? 'submit' : 'button'}
        form={formId}
        disabled={isSubmitting || isDisabled}
        onClick={formId ? undefined : onSubmit}
        className={`${InfoButton} min-h-9 w-full px-4 text-sm sm:min-h-10 sm:w-auto`}
      >
        {isSubmitting ? submittingLabel : submitLabel}
      </button>
    )}
  </div>
);
