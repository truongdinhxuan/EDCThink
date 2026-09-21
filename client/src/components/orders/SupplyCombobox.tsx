import { useState, type RefObject } from 'react';
import { listSupplies } from '../../api/supplies.service';
import { useServerLookup } from '../../hooks/useServerLookup';
import { queryKeys } from '../../lib/queryKeys';
import type { SupplyOption } from '../../types/supplies';
import { ServerCombobox } from '../common/ServerCombobox';

interface SupplyComboboxProps {
  value: string;
  selectedSupply?: SupplyOption | null;
  onChange: (supply: SupplyOption | null) => void;
  onSelected?: (supply: SupplyOption) => void;
  disabled?: boolean;
  ariaLabel: string;
  error?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  autoFocusFlag?: boolean;
}

const supplyOptionLabel = (
  supply: Pick<SupplyOption, 'code' | 'short_text' | 'description'>,
): string => {
  const detail = supply.short_text?.trim() || supply.description?.trim();
  return detail ? `${supply.code} — ${detail}` : supply.code;
};

/**
 * Supply picker: the search, the wording and the row layout; everything about
 * being a combobox lives in {@link ServerCombobox}.
 */
export const SupplyCombobox = ({
  value,
  selectedSupply = null,
  onChange,
  onSelected,
  disabled = false,
  ariaLabel,
  error,
  inputRef,
  autoFocusFlag = false,
}: SupplyComboboxProps) => {
  // Mirrors the list's own open state purely to gate the query: a closed picker
  // should not be fetching a catalogue nobody has asked to see.
  const [open, setOpen] = useState(false);
  const { search, setSearch, items, loading, error: lookupError } = useServerLookup<SupplyOption>({
    loader: (searchTerm, signal) => listSupplies(
      {
        page: 1,
        pageSize: 20,
        search: searchTerm,
        isActive: true,
        isDeleted: false,
        sortBy: 'code',
        sortOrder: 'asc',
      },
      signal,
    ),
    queryKey: (searchTerm) => queryKeys.supplies.lookup({
      search: searchTerm,
      pageSize: 20,
      isActive: true,
      isDeleted: false,
    }),
    errorMessage: 'Không thể tải danh sách vật tư.',
    enabled: open,
    delay: 300,
  });

  return (
    <ServerCombobox<SupplyOption>
      value={value}
      selected={selectedSupply}
      items={items}
      search={search}
      setSearch={setSearch}
      loading={loading}
      lookupError={lookupError}
      onChange={onChange}
      onSelected={onSelected}
      onOpenChange={setOpen}
      getLabel={supplyOptionLabel}
      renderOption={(option) => (
        <>
          <span className="min-w-0">
            <span className="block truncate font-semibold">{option.code}</span>
            {(option.short_text || option.description) && (
              <span className="block truncate text-xs text-slate-500">
                {option.short_text?.trim() || option.description?.trim()}
              </span>
            )}
          </span>
          {option.category?.code && (
            <span className="shrink-0 text-xs text-slate-400">{option.category.code}</span>
          )}
        </>
      )}
      placeholder="Nhập mã hoặc tên vật tư…"
      loadingText="Đang tải danh sách vật tư…"
      emptyText="Không có vật tư active."
      noMatchText="Không có vật tư phù hợp."
      clearLabel="Bỏ chọn vật tư"
      disabled={disabled}
      ariaLabel={ariaLabel}
      error={error}
      inputRef={inputRef}
      autoFocusFlag={autoFocusFlag}
    />
  );
};
