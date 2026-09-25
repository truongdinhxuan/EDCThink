import { useState } from 'react';
import type { StockBalance } from '../../types/stock-balances';
import {
  StorageLocationLabelsPicker,
  type LocationLabel,
} from '../common/StorageLocationLabelsPicker';
import { CrudDrawerForm } from '../crud/CrudDrawerForm';
import { labelClassName } from '../crud/CrudPrimitives';

const idsOf = (locations: LocationLabel[]) =>
  locations.map((location) => location.id).sort().join(',');

/**
 * Relabels where one code sits. The quantity is untouched and no transaction is
 * written: labels are a finding aid, not part of the stock record.
 */
export const StockBalanceLocationsForm = ({
  balance,
  busy,
  onSave,
}: {
  balance: StockBalance;
  busy: boolean;
  onSave: (locationIds: string[]) => Promise<void>;
}) => {
  const [locations, setLocations] = useState<LocationLabel[]>(balance.locations);
  const isDirty = idsOf(locations) !== idsOf(balance.locations);

  return (
    <CrudDrawerForm
      isDirty={isDirty}
      busy={busy}
      submitDisabled={!isDirty}
      onSubmit={() => onSave(locations.map((location) => location.id))}
    >
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
        <p className="font-semibold text-slate-900">
          {balance.supply?.code ?? 'Vật tư'}
          {balance.provider ? ` · ${balance.provider.code}` : ''}
          {balance.set_per_qty ? ` · ${balance.set_per_qty} SET/chồng` : ''}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {balance.area ? `${balance.area.code} — ${balance.area.name}` : '—'}
        </p>
        <p className="mt-2 text-xs text-slate-600">
          Vị trí chỉ là nhãn cho biết mã đang nằm ở đâu. Đổi nhãn không thay đổi số tồn và không tạo giao dịch.
        </p>
      </div>
      <div className={labelClassName}>
        <span>Vị trí kho</span>
        <StorageLocationLabelsPicker
          areaId={balance.area_id}
          value={locations}
          onChange={setLocations}
          disabled={busy}
          ariaLabel="Thêm vị trí kho cho mã vật tư"
        />
      </div>
    </CrudDrawerForm>
  );
};
