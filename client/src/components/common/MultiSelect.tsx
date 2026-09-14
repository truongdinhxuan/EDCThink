import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { APP_LAYER } from '../../constants/layers';

export interface MultiSelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  ariaLabel: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  loading?: boolean;
  error?: string | null;
}

export const MultiSelect = ({
  options,
  value,
  onChange,
  ariaLabel,
  placeholder = 'Chọn một hoặc nhiều mục',
  searchPlaceholder = 'Tìm kiếm...',
  emptyText = 'Không có lựa chọn phù hợp.',
  disabled = false,
  loading = false,
  error = null,
}: MultiSelectProps) => {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const effectiveDisabled = disabled || loading || Boolean(error);

  const optionMap = useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options],
  );
  const selectedOptions = value.map(
    (selectedValue) => optionMap.get(selectedValue) ?? {
      value: selectedValue,
      label: selectedValue,
      disabled: true,
    },
  );
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredOptions = useMemo(
    () => options.filter((option) => {
      if (!normalizedSearch) return true;
      return `${option.label} ${option.description ?? ''}`
        .toLocaleLowerCase()
        .includes(normalizedSearch);
    }),
    [normalizedSearch, options],
  );
  const selectableOptions = filteredOptions.filter((option) => !option.disabled);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const safeHighlightedIndex = Math.min(
    highlightedIndex,
    Math.max(0, selectableOptions.length - 1),
  );

  const toggleOption = (option: MultiSelectOption) => {
    if (option.disabled || effectiveDisabled) return;
    onChange(
      value.includes(option.value)
        ? value.filter((selectedValue) => selectedValue !== option.value)
        : [...value, option.value],
    );
    setSearch('');
    inputRef.current?.focus();
  };

  const removeOption = (optionValue: string) => {
    if (effectiveDisabled) return;
    onChange(value.filter((selectedValue) => selectedValue !== optionValue));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (effectiveDisabled) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setHighlightedIndex((current) => {
        if (selectableOptions.length === 0) return 0;
        const safeCurrent = Math.min(current, selectableOptions.length - 1);
        return (safeCurrent + direction + selectableOptions.length)
          % selectableOptions.length;
      });
      return;
    }
    if (event.key === 'Enter' && open) {
      event.preventDefault();
      const option = selectableOptions[safeHighlightedIndex];
      if (option) toggleOption(option);
      return;
    }
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'Backspace' && !search && value.length > 0) {
      removeOption(value[value.length - 1]);
    }
  };

  return (
    <div ref={rootRef} className="relative space-y-1.5">
      <div
        className={`flex min-h-11 w-full flex-wrap items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm transition ${
          open ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-300'
        } ${effectiveDisabled ? 'cursor-not-allowed bg-slate-100 text-slate-500' : ''}`}
        onClick={() => {
          if (!effectiveDisabled) {
            setOpen(true);
            inputRef.current?.focus();
          }
        }}
      >
        {selectedOptions.map((option) => (
          <span
            key={option.value}
            className="inline-flex max-w-full items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700"
          >
            <span className="truncate">{option.label}</span>
            <button
              type="button"
              disabled={effectiveDisabled}
              onClick={(event) => {
                event.stopPropagation();
                removeOption(option.value);
              }}
              className="rounded-full px-0.5 text-blue-500 hover:bg-blue-100 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label={`Bỏ lựa chọn ${option.label}`}
            >
              <span aria-hidden="true">×</span>
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && selectableOptions[safeHighlightedIndex]
              ? `${listboxId}-${selectableOptions[safeHighlightedIndex].value}`
              : undefined
          }
          disabled={effectiveDisabled}
          value={search}
          placeholder={value.length === 0 ? placeholder : searchPlaceholder}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setSearch(event.target.value);
            setHighlightedIndex(0);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className="min-w-36 flex-1 bg-transparent py-1 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
        />
      </div>

      {open && !effectiveDisabled && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          aria-multiselectable="true"
          className="absolute mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
          style={{ zIndex: APP_LAYER.dropdown }}
        >
          {filteredOptions.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-slate-500">
              {emptyText}
            </p>
          ) : filteredOptions.map((option) => {
            const selected = value.includes(option.value);
            const selectableIndex = selectableOptions.findIndex(
              (candidate) => candidate.value === option.value,
            );
            const highlighted = selectableIndex === safeHighlightedIndex;
            return (
              <button
                id={`${listboxId}-${option.value}`}
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={option.disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => toggleOption(option)}
                className={`flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
                  highlighted ? 'bg-blue-50 text-blue-800' : 'hover:bg-slate-50'
                } ${option.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{option.label}</span>
                  {option.description && (
                    <span className="block truncate text-xs text-slate-500">
                      {option.description}
                    </span>
                  )}
                </span>
                <span aria-hidden="true" className="shrink-0 text-blue-600">
                  {selected ? '✓' : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {loading && <p className="text-xs text-slate-500">Đang tải lựa chọn...</p>}
      {error && <p role="alert" className="text-xs font-medium text-rose-600">{error}</p>}
    </div>
  );
};
