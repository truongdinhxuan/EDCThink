import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { APP_LAYER } from '../../constants/layers';

export interface ServerComboboxOption {
  id: string;
}

interface ServerComboboxProps<T extends ServerComboboxOption> {
  /** Currently selected id, or '' for none. */
  value: string;
  /** The selected row itself, so the collapsed input can label it without a lookup. */
  selected?: T | null;
  /** Results for the current search — typically `useServerLookup(...).items`. */
  items: T[];
  search: string;
  setSearch: (value: string) => void;
  loading: boolean;
  lookupError?: string | null;
  onChange: (option: T | null) => void;
  onSelected?: (option: T) => void;
  /**
   * Fires as the list opens and closes. Owners that gate their query on it
   * (`enabled: open`) avoid fetching a list nobody has asked to see.
   */
  onOpenChange?: (open: boolean) => void;
  /** One line of text for the collapsed input. */
  getLabel: (option: T) => string;
  /** The row in the dropdown; free to be two lines with a trailing badge. */
  renderOption: (option: T) => ReactNode;
  placeholder: string;
  loadingText: string;
  /** Shown when the source is simply empty. */
  emptyText: string;
  /** Shown when a search matched nothing. */
  noMatchText: string;
  /** Omit to hide the clear button, e.g. where the field is required. */
  clearLabel?: string;
  disabled?: boolean;
  ariaLabel: string;
  error?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  autoFocusFlag?: boolean;
}

const optionDomId = (listboxId: string, optionId: string) => `${listboxId}-opt-${optionId}`;

const MAX_LIST_HEIGHT = 256;
const MIN_LIST_HEIGHT = 120;

/**
 * A single-select field backed by a server search.
 *
 * It replaces the "type in a search box, then pick from the select below it"
 * pair that these forms used to carry. That pair had two failure modes a
 * combobox does not: the select silently showed only the first page of results,
 * so a supply the operator could see themselves typing was often not in the
 * list; and the two controls could disagree, leaving a selection that no longer
 * matched what the search box said.
 *
 * The list is portaled and positioned against the live input rect, because these
 * fields live inside an Offcanvas that scrolls its own body and has a sticky
 * footer — an in-flow dropdown is clipped by one and covered by the other.
 */
export const ServerCombobox = <T extends ServerComboboxOption>({
  value,
  selected = null,
  items,
  search,
  setSearch,
  loading,
  lookupError,
  onChange,
  onSelected,
  onOpenChange,
  getLabel,
  renderOption,
  placeholder,
  loadingText,
  emptyText,
  noMatchText,
  clearLabel,
  disabled = false,
  ariaLabel,
  error,
  inputRef,
  autoFocusFlag = false,
}: ServerComboboxProps<T>) => {
  const listboxId = useId();
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const fieldInputRef = inputRef ?? fallbackInputRef;
  const listRef = useRef<HTMLUListElement | null>(null);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const openRef = useRef(open);
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useLayoutEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  const setOpenState = (next: boolean) => {
    setOpen(next);
    onOpenChangeRef.current?.(next);
  };

  const options = items;
  const safeHighlightedIndex = Math.min(
    highlightedIndex,
    Math.max(0, options.length - 1),
  );
  const selectedLabel = selected ? getLabel(selected) : '';

  // Anchor the portaled listbox to the live input rect (fixed positioning) so it
  // is never clipped by the Offcanvas scroll body or hidden behind its sticky
  // footer. Positioning is imperative — no geometry state, no cascading renders.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const input = fieldInputRef.current;
      const list = listRef.current;
      if (!input || !list) return;
      const rect = input.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const openUp = spaceBelow < MIN_LIST_HEIGHT && spaceAbove > spaceBelow;
      const room = Math.max(MIN_LIST_HEIGHT, Math.min(MAX_LIST_HEIGHT, openUp ? spaceAbove : spaceBelow));
      list.style.left = `${Math.round(rect.left)}px`;
      list.style.width = `${Math.round(rect.width)}px`;
      list.style.top = openUp ? 'auto' : `${Math.round(rect.bottom + 4)}px`;
      list.style.bottom = openUp ? `${Math.round(window.innerHeight - rect.top + 4)}px` : 'auto';
      list.style.maxHeight = `${Math.round(room)}px`;
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, options.length, lookupError, loading, fieldInputRef]);

  // The surrounding Offcanvas closes on a document-capture Escape listener. While
  // the dropdown is open, intercept Escape first so it only dismisses the list.
  useEffect(() => {
    const onEscapeCapture = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !openRef.current) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      setOpen(false);
      onOpenChangeRef.current?.(false);
      setSearch('');
      fieldInputRef.current?.blur();
    };
    document.addEventListener('keydown', onEscapeCapture, true);
    return () => document.removeEventListener('keydown', onEscapeCapture, true);
  }, [fieldInputRef, setSearch]);

  const startEditing = () => {
    if (disabled) return;
    setOpenState(true);
    setHighlightedIndex(0);
    setSearch('');
  };

  const stopEditing = () => {
    setOpenState(false);
    setSearch('');
  };

  const selectOption = (option: T) => {
    onChange(option);
    stopEditing();
    fieldInputRef.current?.blur();
    onSelected?.(option);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        startEditing();
        return;
      }
      if (options.length === 0) return;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setHighlightedIndex((current) => {
        const next = Math.min(current, options.length - 1) + direction;
        return (next + options.length) % options.length;
      });
      return;
    }
    if (event.key === 'Enter' && open) {
      event.preventDefault();
      const option = options[safeHighlightedIndex];
      if (option) selectOption(option);
    }
    // Escape is handled by the document-capture listener above.
  };

  const listbox = open ? createPortal(
    <ul
      ref={listRef}
      id={listboxId}
      role="listbox"
      aria-label={ariaLabel}
      className="fixed overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
      style={{ zIndex: APP_LAYER.primaryDrawerPopover }}
    >
      {loading && options.length === 0 ? (
        <li className="px-3 py-4 text-center text-sm font-normal normal-case text-slate-500">
          {loadingText}
        </li>
      ) : lookupError ? (
        <li className="px-3 py-4 text-center text-sm font-normal normal-case text-rose-600">
          {lookupError}
        </li>
      ) : options.length === 0 ? (
        <li className="px-3 py-4 text-center text-sm font-normal normal-case text-slate-500">
          {search.trim() ? noMatchText : emptyText}
        </li>
      ) : (
        options.map((option, index) => {
          const highlighted = index === safeHighlightedIndex;
          const isSelected = option.id === value;
          return (
            <li key={option.id} role="none">
              <button
                id={optionDomId(listboxId, option.id)}
                type="button"
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setHighlightedIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option)}
                className={`flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm font-normal normal-case transition ${
                  highlighted ? 'bg-blue-50 text-blue-800' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {renderOption(option)}
              </button>
            </li>
          );
        })
      )}
    </ul>,
    document.body,
  ) : null;

  return (
    <div className="relative space-y-1">
      <input
        ref={fieldInputRef}
        type="text"
        role="combobox"
        data-autofocus={autoFocusFlag ? 'true' : undefined}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && options[safeHighlightedIndex]
            ? optionDomId(listboxId, options[safeHighlightedIndex].id)
            : undefined
        }
        autoComplete="off"
        disabled={disabled}
        value={open ? search : selectedLabel}
        placeholder={selectedLabel || placeholder}
        onFocus={startEditing}
        onBlur={stopEditing}
        onChange={(event) => {
          setSearch(event.target.value);
          setHighlightedIndex(0);
        }}
        onKeyDown={handleKeyDown}
        className={`w-full rounded-lg border px-3 py-2 text-sm font-normal normal-case text-slate-800 outline-none disabled:cursor-not-allowed disabled:bg-slate-100 ${
          open ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-300 bg-white'
        }`}
      />

      {clearLabel && value && !disabled && !open && (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChange(null)}
          className="text-xs font-normal normal-case text-slate-500 underline hover:text-rose-600"
        >
          {clearLabel}
        </button>
      )}

      {listbox}

      {error && <span className="block normal-case text-rose-600">{error}</span>}
    </div>
  );
};
