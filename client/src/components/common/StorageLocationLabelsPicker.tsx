import { StorageLocationCombobox } from './StorageLocationCombobox';
import type { StorageLocation, StorageLocationOption } from '../../types/storage-locations';

export type LocationLabel = Pick<StorageLocation, 'id' | 'code' | 'name'>;

interface StorageLocationLabelsPickerProps {
  /** Locations must belong to this Area. Empty means pick an Area first. */
  areaId: string;
  value: LocationLabel[];
  onChange: (locations: LocationLabel[]) => void;
  disabled?: boolean;
  ariaLabel: string;
}

/**
 * Where a code sits, as a set of labels. Stock no longer has a quantity per
 * location, so this is a plain many-valued tag field: pick to add, × to remove.
 */
export const StorageLocationLabelsPicker = ({
  areaId,
  value,
  onChange,
  disabled = false,
  ariaLabel,
}: StorageLocationLabelsPickerProps) => {
  const add = (location: StorageLocationOption | null) => {
    if (!location || value.some((label) => label.id === location.id)) return;
    onChange([...value, { id: location.id, code: location.code, name: location.name }]
      .sort((left, right) => left.code.localeCompare(right.code)));
  };

  return (
    <div className="space-y-2">
      {/* Always empty: a pick becomes a chip below instead of a selection. */}
      <StorageLocationCombobox
        value=""
        areaId={areaId}
        onChange={add}
        disabled={disabled}
        ariaLabel={ariaLabel}
      />
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Vị trí đã gắn">
          {value.map((location) => (
            <li
              key={location.id}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-2.5 pr-1 text-xs font-semibold text-slate-700"
            >
              <span title={location.name ?? undefined}>{location.code}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(value.filter((label) => label.id !== location.id))}
                aria-label={`Bỏ vị trí ${location.code}`}
                className="rounded-full px-1.5 leading-5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-50"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-500">Chưa gắn vị trí nào. Có thể để trống.</p>
      )}
    </div>
  );
};
