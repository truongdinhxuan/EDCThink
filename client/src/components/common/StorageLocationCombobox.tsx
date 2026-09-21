import { useState, type RefObject } from 'react';
import { listStorageLocations } from '../../api/storage-locations.service';
import { useServerLookup } from '../../hooks/useServerLookup';
import { queryKeys } from '../../lib/queryKeys';
import type { StorageLocationOption } from '../../types/storage-locations';
import { ServerCombobox } from './ServerCombobox';

interface StorageLocationComboboxProps {
  value: string;
  selectedLocation?: StorageLocationOption | null;
  /** Narrows the search. Empty means no Area is chosen yet, so the field waits. */
  areaId: string;
  onChange: (location: StorageLocationOption | null) => void;
  disabled?: boolean;
  ariaLabel: string;
  error?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}

const locationLabel = (
  location: Pick<StorageLocationOption, 'code' | 'name'>,
): string => (location.name?.trim()
  ? `${location.code} — ${location.name.trim()}`
  : location.code);

/**
 * Storage location picker, scoped to one Area.
 *
 * Without an Area there is nothing sensible to search, so the field disables
 * itself and says which step is missing rather than offering an empty list.
 */
export const StorageLocationCombobox = ({
  value,
  selectedLocation = null,
  areaId,
  onChange,
  disabled = false,
  ariaLabel,
  error,
  inputRef,
}: StorageLocationComboboxProps) => {
  const [open, setOpen] = useState(false);
  const { search, setSearch, items, loading, error: lookupError } = useServerLookup<StorageLocationOption>({
    loader: (searchTerm, signal) => listStorageLocations(
      {
        page: 1,
        pageSize: 20,
        search: searchTerm,
        areaId: areaId || undefined,
        isActive: true,
        sortBy: 'code',
        sortOrder: 'asc',
      },
      signal,
    ),
    queryKey: (searchTerm) => queryKeys.storageLocations.lookup({
      search: searchTerm,
      areaId: areaId || undefined,
      pageSize: 20,
      isActive: true,
    }),
    errorMessage: 'Không thể tải danh sách vị trí kho.',
    enabled: open && Boolean(areaId),
    delay: 300,
  });

  return (
    <ServerCombobox<StorageLocationOption>
      value={value}
      selected={selectedLocation}
      items={items}
      search={search}
      setSearch={setSearch}
      loading={loading}
      lookupError={lookupError}
      onChange={onChange}
      onOpenChange={setOpen}
      getLabel={locationLabel}
      renderOption={(option) => (
        <span className="min-w-0">
          <span className="block truncate font-semibold">{option.code}</span>
          {option.name && (
            <span className="block truncate text-xs text-slate-500">{option.name}</span>
          )}
        </span>
      )}
      placeholder={areaId ? 'Nhập mã hoặc tên vị trí kho…' : 'Chọn khu vực trước'}
      loadingText="Đang tải danh sách vị trí kho…"
      emptyText="Khu vực chưa có vị trí kho active."
      noMatchText="Không có vị trí kho phù hợp."
      clearLabel="Bỏ chọn vị trí kho"
      disabled={disabled || !areaId}
      ariaLabel={ariaLabel}
      error={error}
      inputRef={inputRef}
    />
  );
};
