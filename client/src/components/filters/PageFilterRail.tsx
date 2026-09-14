import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faChevronLeft,
  faFilter,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { APP_LAYER } from '../../constants/layers';
import { useFilterRail } from '../../hooks/useFilterRail';
import { useBodyScrollLock } from '../../utils/bodyScrollLock';
import {
  focusFirstElement,
  restoreFocus,
  trapTabKey,
} from '../../utils/focusManagement';
import { getButtonClassName } from '../common/Button';

interface PageFilterRailProps {
  title?: string;
  children: ReactNode;
  onReset?: () => void;
  resetDisabled?: boolean;
}

export const FilterSection = ({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) => (
  <section className="space-y-3">
    {title && (
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
    )}
    <div className="space-y-3">{children}</div>
  </section>
);

export const FilterField = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <label className="block space-y-1.5 text-sm font-semibold text-slate-700">
    <span>{label}</span>
    {children}
  </label>
);

const FilterRailContent = ({
  title,
  titleId,
  children,
  onReset,
  resetDisabled,
  onClose,
  mobile,
}: PageFilterRailProps & {
  titleId?: string;
  onClose?: () => void;
  mobile?: boolean;
}) => (
  <>
    <header className={`flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 ${mobile ? '' : 'pr-12'}`}>
      <div className="min-w-0">
        <h2 id={titleId} className="truncate text-sm font-bold text-slate-900">{title}</h2>
        <p className="mt-0.5 text-xs text-slate-500">Thu hẹp dữ liệu đang hiển thị</p>
      </div>
      {mobile && onClose && (
        <button
          type="button"
          onClick={onClose}
          className={getButtonClassName({ variant: 'icon', size: 'icon' })}
          aria-label="Đóng bộ lọc"
        >
          <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
        </button>
      )}
    </header>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
      {children}
    </div>
    {onReset && (
      <footer className="shrink-0 border-t border-slate-200 px-4 py-3">
        <button
          type="button"
          onClick={onReset}
          disabled={resetDisabled}
          className={getButtonClassName({ variant: 'secondary', size: 'sm', block: true })}
        >
          Đặt lại bộ lọc
        </button>
      </footer>
    )}
  </>
);

export const PageFilterRail = ({
  title = 'Bộ lọc',
  children,
  onReset,
  resetDisabled = false,
}: PageFilterRailProps) => {
  const reactId = useId();
  const railId = `page-filter-${reactId.replace(/:/g, '')}`;
  const panelId = `${railId}-drawer`;
  const titleId = `${railId}-title`;
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const mobilePanelRef = useRef<HTMLDivElement>(null);
  const wasMobileOpen = useRef(false);
  const {
    activeRailId,
    lastClose,
    openFilterRail,
    closeFilterRail,
  } = useFilterRail();
  const mobileOpen = activeRailId === railId;

  useBodyScrollLock(mobileOpen, `${railId}-mobile-drawer`);

  useEffect(() => {
    if (mobilePanelRef.current) mobilePanelRef.current.inert = !mobileOpen;
  }, [mobileOpen]);

  useEffect(() => {
    if (mobileOpen) {
      wasMobileOpen.current = true;
      const frame = window.requestAnimationFrame(() => {
        if (mobilePanelRef.current) focusFirstElement(mobilePanelRef.current);
      });
      return () => window.cancelAnimationFrame(frame);
    }
    if (wasMobileOpen.current) {
      wasMobileOpen.current = false;
      if (lastClose?.railId === railId && lastClose.restoreFocus) {
        restoreFocus(triggerRef.current);
      }
    }
    return undefined;
  }, [lastClose, mobileOpen, railId]);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      const panel = mobilePanelRef.current;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeFilterRail(railId);
      } else if (event.key === 'Tab' && panel) {
        trapTabKey(event, panel);
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [closeFilterRail, mobileOpen, railId]);

  useEffect(() => {
    const desktopMedia = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) closeFilterRail(railId, false);
    };
    desktopMedia.addEventListener('change', closeOnDesktop);
    return () => desktopMedia.removeEventListener('change', closeOnDesktop);
  }, [closeFilterRail, railId]);

  useEffect(() => () => closeFilterRail(railId, false), [closeFilterRail, railId]);

  const mobileDrawer = typeof document === 'undefined' ? null : createPortal(
    <div className="lg:hidden">
      <button
        type="button"
        aria-label="Đóng bộ lọc"
        tabIndex={-1}
        disabled={!mobileOpen}
        data-filter-backdrop="true"
        data-open={mobileOpen}
        className="fixed inset-0 border-0 bg-slate-950/45 p-0 backdrop-blur-[2px] hover:cursor-pointer"
        style={{ zIndex: APP_LAYER.filterBackdrop }}
        onClick={() => closeFilterRail(railId)}
      />
      <section
        ref={mobilePanelRef}
        id={panelId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={!mobileOpen || undefined}
        tabIndex={-1}
        data-filter-panel="true"
        data-open={mobileOpen}
        className="filter-rail-panel fixed inset-y-0 left-0 flex h-screen w-[min(20rem,100dvw)] max-w-full flex-col overflow-hidden bg-white shadow-2xl outline-none"
        style={{ zIndex: APP_LAYER.filterDrawer }}
      >
        <FilterRailContent
          title={title}
          titleId={titleId}
          onReset={onReset}
          resetDisabled={resetDisabled}
          onClose={() => closeFilterRail(railId)}
          mobile
        >
          {children}
        </FilterRailContent>
      </section>
    </div>,
    document.body,
  );

  return (
    <>
      <div className="lg:hidden">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => openFilterRail(railId)}
          className={getButtonClassName({ variant: 'secondary', size: 'sm' })}
          aria-label="Mở bộ lọc"
          aria-controls={panelId}
          aria-expanded={mobileOpen}
        >
          <FontAwesomeIcon  icon={faFilter} aria-hidden="true" />
          <FontAwesomeIcon icon={faFilter} aria-hidden="true" />
          Bộ lọc
        </button>
      </div>

      <aside
        className={`transition-all duration-200 ease-in-out relative hidden shrink-0 self-start overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-0 lg:flex lg:max-h-[calc(100dvh-8rem)] lg:flex-col ${desktopCollapsed ? 'lg:w-12' : 'lg:w-64'}`}
      aria-label={title}
      >
        {desktopCollapsed ? (
          <button
            type="button"
            onClick={() => setDesktopCollapsed(false)}
            className={getButtonClassName({
              variant: 'icon',
              size: 'icon',
              className: 'm-1.5',
      
            })}
            aria-label="Mở rộng bộ lọc"
            aria-expanded={false}
          >
            <FontAwesomeIcon icon={faFilter} aria-hidden="true" />
          </button>
        ) : (
          <>
            <FilterRailContent
              title={title}
              onReset={onReset}
              resetDisabled={resetDisabled}
            >
              {children}
            </FilterRailContent>
            <button
              type="button"
              onClick={() => setDesktopCollapsed(true)}
              className={getButtonClassName({
                variant: 'icon',
                size: 'icon',
                className: 'absolute right-2 top-2',
              })}
              aria-label="Thu gọn bộ lọc"
              aria-expanded={true}
            >
              <FontAwesomeIcon icon={faChevronLeft} aria-hidden="true" />
            </button>
          </>
        )}
      </aside>
      {mobileDrawer}
    </>
  );
};

export const PageFilterLayout = ({
  rail,
  children,
}: {
  rail: ReactNode;
  children: ReactNode;
}) => (
  <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
    {rail}
    <div className="min-w-0 flex-1">{children}</div>
  </div>
);