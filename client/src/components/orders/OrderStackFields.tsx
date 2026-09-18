import { type Ref } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getApiErrorMessage } from '../../api/errors';
import { getSupplyStackOptions } from '../../api/supplies.service';
import { queryKeys } from '../../lib/queryKeys';
import { SelectSkeleton } from '../common/skeleton';

interface OrderStackFieldsProps {
  compact?: boolean;
  supplyId: string;
  providerId: string;
  areaId: string;
  setPerQty?: number;
  requestedStackQuantity?: number;
  onSetPerQtyChange: (value: number | undefined) => void;
  onRequestedStackQuantityChange: (value: number | undefined) => void;
  setPerQtyError?: string;
  requestedStackQuantityError?: string;
  setPerQtySelectRef?: Ref<HTMLSelectElement>;
}

export const OrderStackFields = ({
  compact = false,
  supplyId,
  providerId,
  areaId,
  setPerQty,
  requestedStackQuantity,
  onSetPerQtyChange,
  onRequestedStackQuantityChange,
  setPerQtyError,
  requestedStackQuantityError,
  setPerQtySelectRef,
}: OrderStackFieldsProps) => {
  const enabled = Boolean(supplyId && providerId && areaId);
  const optionsQuery = useQuery({
    queryKey: queryKeys.supplyStackOptions.list(supplyId, providerId, areaId),
    queryFn: ({ signal }) => getSupplyStackOptions(
      supplyId,
      { provider_id: providerId, area_id: areaId },
      signal,
    ),
    enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
  const options = optionsQuery.data ?? [];
  const selected = options.find((option) => option.set_per_qty === setPerQty);
  const total = setPerQty && requestedStackQuantity
    ? setPerQty * requestedStackQuantity
    : 0;
  const exceedsSnapshot = Boolean(
    selected
      && requestedStackQuantity
      && requestedStackQuantity > selected.available_stack_quantity,
  );

  return (
    <div className={compact
      ? 'grid gap-3 sm:col-span-2 sm:grid-cols-2'
      : 'grid gap-3 md:col-span-2 xl:col-span-3 xl:grid-cols-3'}>
      <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        SET / chồng
        {!enabled ? (
          <select disabled className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-normal normal-case text-slate-500">
            <option>Chọn Supply và Provider trước</option>
          </select>
        ) : optionsQuery.isPending ? (
          <SelectSkeleton label="Đang tải quy cách chồng" />
        ) : (
          <select
            ref={setPerQtySelectRef}
            value={setPerQty ?? ''}
            onChange={(event) => onSetPerQtyChange(
              event.target.value ? Number(event.target.value) : undefined,
            )}
            disabled={optionsQuery.isError || options.length === 0}
            aria-label="Chọn số SET trên mỗi chồng"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal normal-case text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100"
          >
            <option value="">
              {optionsQuery.isError
                ? 'Không thể tải quy cách chồng'
                : options.length === 0
                  ? 'Không có quy cách chồng đang tồn kho'
                  : 'Chọn quy cách chồng'}
            </option>
            {options.map((option) => (
              <option key={option.set_per_qty} value={option.set_per_qty}>
                {option.set_per_qty} SET/chồng — còn {option.available_stack_quantity} chồng
              </option>
            ))}
          </select>
        )}
        {optionsQuery.isError && (
          <span className="block normal-case text-rose-600">
            {getApiErrorMessage(optionsQuery.error, 'Không thể tải quy cách chồng.')}
          </span>
        )}
        {setPerQtyError && <span className="block normal-case text-rose-600">{setPerQtyError}</span>}
      </label>

      <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Số chồng
        <input
          type="number"
          step="1"
          min="1"
          value={requestedStackQuantity ?? ''}
          onChange={(event) => onRequestedStackQuantityChange(
            event.target.value ? Number(event.target.value) : undefined,
          )}
          disabled={!setPerQty}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100"
        />
        {requestedStackQuantityError && (
          <span className="block normal-case text-rose-600">{requestedStackQuantityError}</span>
        )}
        {selected && !exceedsSnapshot && (
          <span className="block font-medium normal-case text-emerald-700">
            Tồn khả dụng: {selected.available_stack_quantity} chồng
          </span>
        )}
        {exceedsSnapshot && (
          <span className="block font-medium normal-case text-amber-700">
            Cảnh báo: yêu cầu lớn hơn tồn hiện tại ({selected?.available_stack_quantity} chồng). Order vẫn có thể được gửi.
          </span>
        )}
      </label>

      <div className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Tổng SET
        <p
          aria-live="polite"
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal normal-case text-slate-600"
        >
          {total ? `${setPerQty} × ${requestedStackQuantity} = ${total} SET` : 'Tự động tính'}
        </p>
      </div>
    </div>
  );
};
