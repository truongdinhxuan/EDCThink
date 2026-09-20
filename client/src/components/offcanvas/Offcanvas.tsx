import { useEffect, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { APP_LAYER } from '../../constants/layers';
import type {
  DrawerPhase,
  OffcanvasCloseReason,
  OffcanvasSize,
} from '../../types/offcanvas.types';


const SIZE_CLASS_NAMES: Record<OffcanvasSize, string> = {
  sm: 'md:w-[min(60vw,27rem)]',
  md: 'md:w-[65vw] md:max-w-[35rem] xl:w-[35rem]',
  lg: 'md:w-[70vw] md:max-w-[40rem] xl:w-[40rem]',
  full: 'md:w-[calc(100dvw-4rem)] xl:w-[min(90dvw,80rem)]',
};

interface OffcanvasProps {
  id: string;
  phase: DrawerPhase;
  layer: 'primary' | 'confirmation';
  role: 'dialog' | 'alertdialog';
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: OffcanvasSize;
  isTopmost: boolean;
  busy?: boolean;
  panelRef: RefObject<HTMLDivElement | null>;
  onRequestClose: (reason: OffcanvasCloseReason) => void;
}

export const Offcanvas = ({
  id,
  phase,
  layer,
  role,
  title,
  description,
  children,
  footer,
  size = 'md',
  isTopmost,
  busy = false,
  panelRef,
  onRequestClose,
}: OffcanvasProps) => {
  const titleId = `${id}-title`;
  const descriptionId = description ? `${id}-description` : undefined;
  const backdropLayer = layer === 'primary'
    ? APP_LAYER.primaryBackdrop
    : APP_LAYER.confirmationBackdrop;
  const panelLayer = layer === 'primary'
    ? APP_LAYER.primaryDrawer
    : APP_LAYER.confirmationDrawer;

  useEffect(() => {
    if (panelRef.current) panelRef.current.inert = !isTopmost;
  }, [isTopmost, panelRef]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div data-offcanvas-layer={layer} data-state={phase}>
      <button
        type="button"
        aria-label={`Đóng ${title}`}
        tabIndex={-1}
        data-offcanvas-backdrop="true"
        data-state={phase}
        disabled={!isTopmost || busy}
        className={`offcanvas-backdrop fixed inset-0 border-0 bg-slate-950/45 p-0 backdrop-blur-[2px] ${isTopmost ? '' : 'pointer-events-none'}`}
        style={{ zIndex: backdropLayer }}
        onClick={() => onRequestClose('backdrop')}
      />

      <section
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-hidden={!isTopmost || undefined}
        tabIndex={-1}
        data-offcanvas-panel="true"
        data-state={phase}
        className={`offcanvas-panel fixed inset-y-0 right-0 flex h-dvh w-screen w-[100dvw] max-w-full flex-col overflow-hidden bg-white shadow-2xl outline-none ${SIZE_CLASS_NAMES[size]} ${isTopmost ? '' : 'pointer-events-none'}`}
        style={{ zIndex: panelLayer }}
      >
        <header className="sticky top-0 z-10 flex min-w-0 shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="break-words text-lg font-bold text-slate-900">
              {title}
            </h2>
            {description && (
              <div id={descriptionId} className="mt-1 break-words text-sm leading-5 text-slate-500">
                {description}
              </div>
            )}
          </div>
        </header>

        <div
          data-offcanvas-body="true"
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
        >
          {children}
        </div>

        {footer && (
          <footer className="sticky bottom-0 z-10 shrink-0 border-t border-slate-200 bg-white px-4 py-3 sm:px-5 sm:py-4">
            {footer}
          </footer>
        )}
      </section>
    </div>,
    document.body,
  );
};
