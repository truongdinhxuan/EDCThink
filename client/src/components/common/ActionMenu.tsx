import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEllipsis } from '@fortawesome/free-solid-svg-icons';
import { APP_LAYER } from '../../constants/layers';

export interface ActionMenuItem {
  label: string;
  /**
   * Receives the trigger button, which stays mounted while the menu closes, so
   * callers can hand it to a drawer or confirmation as the element to return
   * focus to. A menu item cannot serve that purpose: it is already gone.
   */
  onSelect: (trigger: HTMLElement | null) => void;
  /** Renders in red and sits below a divider, like a destructive action should. */
  danger?: boolean;
  /**
   * A page-specific action, e.g. Permissions on Roles. Leads the menu in the
   * accent colour, so it reads as the reason this row's menu exists rather than
   * as one more variation of Xem/Sửa.
   */
  primary?: boolean;
  disabled?: boolean;
}

interface ActionMenuProps {
  items: ActionMenuItem[];
  /**
   * The trigger is an icon with no text, so this is its only accessible name.
   * Pass something row-specific where possible, e.g. "Thao tác cho đơn vị Cái".
   */
  ariaLabel?: string;
}

// Bare icon: no border, no fill, no shadow. The hit area is kept at 36px and a
// focus ring is kept for keyboard users, since neither is a background.
const TRIGGER_CLASS_NAME = 'inline-flex h-9 w-9 items-center justify-center rounded-md '
  + 'border-0 bg-transparent p-0 align-middle select-none leading-none '
  + 'transition-colors hover:text-stone-900 '
  + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 '
  + 'disabled:cursor-not-allowed disabled:opacity-40';

const ITEM_CLASS_NAME = 'block w-full rounded-md px-4 py-2 text-left text-sm '
  + 'transition-colors disabled:cursor-not-allowed disabled:opacity-50 '
  + 'disabled:hover:bg-transparent';

// Three tiers, three colours: what this page adds, what every page has, and what
// cannot be undone.
const PRIMARY_ITEM_CLASS_NAME = 'font-semibold hover:bg-stone-100';
const STANDARD_ITEM_CLASS_NAME = 'text-stone-800 hover:bg-stone-100';
const DANGER_ITEM_CLASS_NAME = 'text-red-500 hover:bg-red-100';

const MENU_GAP = 8;
const VIEWPORT_MARGIN = 8;

/**
 * A row-level action menu.
 *
 * It is rendered into document.body rather than beside the trigger: the table it
 * lives in clips its own overflow both ways, so an absolutely positioned menu
 * would be cut off on the last rows and on narrow screens.
 */
export const ActionMenu = ({ items, ariaLabel = 'Thao tác' }: ActionMenuProps) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const enabledCount = items.filter((item) => !item.disabled).length;

  // Position is written straight onto the node instead of through state: the
  // parent table re-renders on every refetch, and a style prop would fight the
  // measurement. React leaves top/left alone because it never declares them.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return undefined;

    const place = () => {
      const anchor = trigger.getBoundingClientRect();
      const { width, height } = menu.getBoundingClientRect();
      const fitsBelow = anchor.bottom + MENU_GAP + height <= window.innerHeight;
      const fitsAbove = anchor.top - MENU_GAP - height >= 0;
      menu.style.top = `${fitsBelow || !fitsAbove
        ? anchor.bottom + MENU_GAP
        : anchor.top - MENU_GAP - height}px`;
      menu.style.left = `${Math.min(
        Math.max(VIEWPORT_MARGIN, anchor.left),
        Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN),
      )}px`;
    };

    place();
    // Capture phase so the menu follows the table's own scroll container too.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  // Opening with the keyboard must land on something actionable.
  useLayoutEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
  }, [open]);

  const moveFocus = (from: HTMLElement, step: 1 | -1) => {
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
      'button:not([disabled])',
    ) ?? [])];
    if (buttons.length === 0) return;
    const next = buttons.indexOf(from as HTMLButtonElement) + step;
    buttons[(next + buttons.length) % buttons.length]?.focus();
  };

  const select = (item: ActionMenuItem) => {
    const trigger = triggerRef.current;
    setOpen(false);
    trigger?.focus();
    item.onSelect(trigger);
  };

  if (items.length === 0) return null;

  // Rendered in this order whatever order they arrived in, so a destructive
  // action can never drift up next to an everyday one.
  const groups = [
    items.filter((item) => item.primary && !item.danger),
    items.filter((item) => !item.primary && !item.danger),
    items.filter((item) => item.danger),
  ].filter((group) => group.length > 0);

  const renderItem = (item: ActionMenuItem) => (
    <button
      key={item.label}
      type="button"
      role="menuitem"
      disabled={item.disabled}
      onClick={() => select(item)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          moveFocus(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1);
        }
      }}
      className={`${ITEM_CLASS_NAME} ${item.danger
        ? DANGER_ITEM_CLASS_NAME
        : item.primary
          ? PRIMARY_ITEM_CLASS_NAME
          : STANDARD_ITEM_CLASS_NAME} hover:cursor-pointer`}
    >
      {item.label}
    </button>
  );

  return (
    <div className="flex justify-end">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={enabledCount === 0}
        onClick={() => setOpen((current) => !current)}
        className={`${TRIGGER_CLASS_NAME} ${open ? 'text-stone-900' : 'text-stone-500'} m-auto flex align-center justify-center hover:cursor-pointer`}
      >
        <FontAwesomeIcon fontSize="1.5rem" icon={faEllipsis} aria-hidden="true" />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={ariaLabel}
          className="min-w-[10rem] rounded-lg border border-stone-200 bg-white p-1 shadow-lg"
          style={{ position: 'fixed', zIndex: APP_LAYER.dropdown }}
        >
          {/* Fragments, not wrapper divs: a menu's children should be its
              items, and a separator is a role of its own. */}
          {groups.map((group, index) => (
            <Fragment key={group[0]?.label ?? index}>
              {index > 0 && (
                <div role="separator" className="my-1 h-px bg-stone-200" />
              )}
              {group.map(renderItem)}
            </Fragment>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
};
