import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { listAreas } from '../../api/areas.service';
import { listStorageLocations } from '../../api/storage-locations.service';
import { listSupplies } from '../../api/supplies.service';
import { useCrudResource } from '../../hooks/useCrudResource';
import { useServerLookup } from '../../hooks/useServerLookup';
import { queryKeys } from '../../lib/queryKeys';
import type { CreateStockAdjustmentInput, StockAdjustmentType } from '../../types/stock-transactions';
import { SupplyProviderSelect } from '../common/SupplyProviderSelect';
import { SelectSkeleton } from '../common/skeleton';
import { CrudModal, FieldError, FormActions, inputClassName, labelClassName } from '../crud/CrudPrimitives';

const ADJUSTMENT_TYPES: readonly { value: StockAdjustmentType; label: string }[] = [
  { value: 'ADJUSTMENT_IN', label: 'Adjustment tăng' },
  { value: 'ADJUSTMENT_OUT', label: 'Adjustment giảm' },
  { value: 'IMPORT', label: 'Nhập kho' },
  { value: 'EXPORT', label: 'Xuất kho' },
];

const loadAreas = async (signal: AbortSignal) =>
  (await listAreas(
    { page: 1, pageSize: 100, isActive: true, sortBy: 'code', sortOrder: 'asc' },
    signal,
  )).data;

export const StockAdjustmentModal = ({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: CreateStockAdjustmentInput) => Promise<boolean>;
}) => {
  const areas = useCrudResource(
    loadAreas,
    'Không thể tải danh sách khu vực.',
    queryKeys.areas.lookup({ pageSize: 100, isActive: true }),
  );
  const [selectedAreaId, setSelectedAreaId] = useState('');
  const supplyLoader = useCallback(
    (search: string | undefined, signal: AbortSignal) => listSupplies(
      { page: 1, pageSize: 20, search, isActive: true, isDeleted: false, sortBy: 'code', sortOrder: 'asc' },
      signal,
    ),
    [],
  );
  const locationLoader = useCallback(
    (search: string | undefined, signal: AbortSignal) => listStorageLocations(
      { page: 1, pageSize: 20, search, areaId: selectedAreaId || undefined, isActive: true, sortBy: 'code', sortOrder: 'asc' },
      signal,
    ),
    [selectedAreaId],
  );
  const supplies = useServerLookup({
    loader: supplyLoader,
    queryKey: (search) => queryKeys.supplies.lookup({ search, pageSize: 20, isActive: true, isDeleted: false }),
    errorMessage: 'Không thể tải danh sách vật tư.',
  });
  const locations = useServerLookup({
    loader: locationLoader,
    queryKey: (search) => queryKeys.storageLocations.lookup({ search, areaId: selectedAreaId || undefined, pageSize: 20, isActive: true }),
    errorMessage: 'Không thể tải danh sách vị trí kho.',
  });
  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<CreateStockAdjustmentInput>({
    defaultValues: {
      supply_id: '',
      provider_id: '',
      area_id: '',
      storage_location_id: '',
      type: 'ADJUSTMENT_IN',
      quantity: 1,
      stack_quantity: undefined,
      set_per_qty: undefined,
      reason: '',
      note: '',
    },
  });
  const selectedSupplyId = useWatch({ control, name: 'supply_id' });
  const selectedProviderId = useWatch({ control, name: 'provider_id' });
  const selectedType = useWatch({ control, name: 'type' });
  const stackQuantity = useWatch({ control, name: 'stack_quantity' });
  const setPerQty = useWatch({ control, name: 'set_per_qty' });
  const selectedSupply = useMemo(
    () => supplies.items.find((supply) => supply.id === selectedSupplyId),
    [selectedSupplyId, supplies.items],
  );
  const isStackSupply = selectedSupply?.category?.code === 'KIEN_SAT_TC';
  const isStackImport = isStackSupply && selectedType === 'IMPORT';
  const isUnsupportedStackAdjustment = isStackSupply && selectedType !== 'IMPORT';
  const totalSetQuantity = isStackImport
    && typeof stackQuantity === 'number'
    && Number.isFinite(stackQuantity)
    && typeof setPerQty === 'number'
    && Number.isFinite(setPerQty)
    ? stackQuantity * setPerQty
    : 0;
  const supplyRegistration = register('supply_id', { required: 'Vui lòng chọn vật tư.' });
  const areaRegistration = register('area_id', { required: 'Vui lòng chọn khu vực.' });
  register('provider_id', { required: 'Vui lòng chọn Provider.' });

  useEffect(() => {
    if (isStackImport) return;
    setValue('stack_quantity', undefined, { shouldValidate: false });
    setValue('set_per_qty', undefined, { shouldValidate: false });
  }, [isStackImport, setValue]);

  const referenceErrors = [supplies.error, areas.error, locations.error].filter(
    (error): error is string => Boolean(error),
  );
  const referencesLoading = supplies.loading || areas.loading || locations.loading;
  const referencesUnavailable = referencesLoading || referenceErrors.length > 0
    || supplies.items.length === 0 || areas.items.length === 0;

  const submit = async (values: CreateStockAdjustmentInput) => {
    const payload: CreateStockAdjustmentInput = {
      ...values,
      reason: values.reason.trim(),
      note: values.note?.trim() || null,
    };
    if (isStackImport) {
      payload.quantity = values.stack_quantity! * values.set_per_qty!;
    } else {
      delete payload.stack_quantity;
      delete payload.set_per_qty;
    }
    if (await onSubmit(payload)) onClose();
  };

  return (
    <CrudModal title="Tạo stock adjustment" busy={busy} onClose={onClose}>
      <form onSubmit={handleSubmit(submit)} className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Adjustment cập nhật StockBalances và tạo StockTransactions mới. Transaction cũ không bị sửa hoặc xóa.
        </div>
        {referenceErrors.length > 0 && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {referenceErrors.map((message) => <p key={message}>{message}</p>)}
          </div>
        )}
        {isUnsupportedStackAdjustment && (
          <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Loại điều chỉnh này hiện chưa hỗ trợ cho kiện sắt tiêu chuẩn. Hãy dùng nghiệp vụ Nhập kho (IMPORT) hoặc chọn vật tư khác.
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={labelClassName}>
            <span>Vật tư</span>
            <input type="search" value={supplies.search} onChange={(event) => supplies.setSearch(event.target.value)} placeholder="Tìm vật tư trên server..." className={inputClassName} />
            {supplies.loading && supplies.items.length === 0 ? <SelectSkeleton label="Đang tải vật tư" /> : (
              <select
                {...supplyRegistration}
                disabled={referencesLoading}
                className={inputClassName}
                onChange={(event) => {
                  void supplyRegistration.onChange(event);
                  setValue('provider_id', '', { shouldValidate: false });
                  setValue('stack_quantity', undefined, { shouldValidate: false });
                  setValue('set_per_qty', undefined, { shouldValidate: false });
                }}
              >
                <option value="">Chọn vật tư</option>
                {supplies.items.map((supply) => <option key={supply.id} value={supply.id}>{supply.code}{supply.description ? ` - ${supply.description}` : ''}</option>)}
              </select>
            )}
            {!supplies.loading && supplies.items.length === 0 ? <FieldError message="Không có vật tư active." /> : <FieldError message={errors.supply_id?.message} />}
          </label>
          <label className={labelClassName}>
            <span>Provider</span>
            <SupplyProviderSelect
              supplyId={selectedSupplyId}
              value={selectedProviderId}
              onChange={(providerId) => setValue('provider_id', providerId, { shouldValidate: true })}
              disabled={busy}
              className={inputClassName}
              ariaLabel="Chọn Provider cho điều chỉnh tồn kho"
            />
            <FieldError message={errors.provider_id?.message} />
          </label>
          <label className={labelClassName}>
            <span>Khu vực</span>
            {areas.loading && areas.items.length === 0 ? <SelectSkeleton label="Đang tải khu vực" /> : (
              <select
                {...areaRegistration}
                disabled={referencesLoading}
                className={inputClassName}
                onChange={(event) => {
                  void areaRegistration.onChange(event);
                  setSelectedAreaId(event.target.value);
                  setValue('storage_location_id', '');
                }}
              >
                <option value="">Chọn khu vực</option>
                {areas.items.map((area) => <option key={area.id} value={area.id}>{area.code} - {area.name}</option>)}
              </select>
            )}
            {!areas.loading && areas.items.length === 0 ? <FieldError message="Không có khu vực active." /> : <FieldError message={errors.area_id?.message} />}
          </label>
          <label className={labelClassName}>
            <span>Vị trí kho</span>
            <input type="search" value={locations.search} onChange={(event) => locations.setSearch(event.target.value)} placeholder="Tìm vị trí kho trên server..." disabled={!selectedAreaId} className={inputClassName} />
            {selectedAreaId && locations.loading && locations.items.length === 0 ? <SelectSkeleton label="Đang tải vị trí kho" /> : (
              <select {...register('storage_location_id', { required: 'Vui lòng chọn vị trí kho.' })} disabled={!selectedAreaId || locations.loading} className={inputClassName}>
                <option value="">{!selectedAreaId ? 'Chọn khu vực trước' : 'Chọn vị trí kho'}</option>
                {locations.items.map((location) => <option key={location.id} value={location.id}>{location.code}{location.name ? ` - ${location.name}` : ''}</option>)}
              </select>
            )}
            {selectedAreaId && !locations.loading && locations.items.length === 0 ? <FieldError message="Khu vực chưa có vị trí kho active." /> : <FieldError message={errors.storage_location_id?.message} />}
          </label>
          <label className={labelClassName}>
            <span>Loại điều chỉnh</span>
            <select {...register('type', { required: true })} className={inputClassName}>
              {ADJUSTMENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </label>
          {isStackImport ? (
            <>
              <label className={labelClassName}>
                <span>Số chồng</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  {...register('stack_quantity', {
                    valueAsNumber: true,
                    required: 'Vui lòng nhập số chồng.',
                    validate: (value) => (typeof value === 'number' && Number.isInteger(value) && value > 0) || 'Số chồng phải là số nguyên lớn hơn 0.',
                  })}
                  className={inputClassName}
                />
                <FieldError message={errors.stack_quantity?.message} />
              </label>
              <label className={labelClassName}>
                <span>SET / chồng</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  {...register('set_per_qty', {
                    valueAsNumber: true,
                    required: 'Vui lòng nhập số SET trên mỗi chồng.',
                    validate: (value) => (typeof value === 'number' && Number.isInteger(value) && value > 0) || 'SET / chồng phải là số nguyên lớn hơn 0.',
                  })}
                  className={inputClassName}
                />
                <FieldError message={errors.set_per_qty?.message} />
              </label>
              <label className={labelClassName}>
                <span>Tổng SET</span>
                <input
                  type="number"
                  value={Number.isFinite(totalSetQuantity) ? totalSetQuantity : 0}
                  readOnly
                  aria-label="Tổng SET được hệ thống tính"
                  className={`${inputClassName} bg-slate-50 font-semibold text-slate-700`}
                />
                <span className="text-xs font-normal text-slate-500">
                  Backend sẽ tính lại số chồng × SET/chồng trước khi cập nhật tồn.
                </span>
              </label>
            </>
          ) : (
            <label className={labelClassName}>
              <span>Số lượng</span>
              <input type="number" min="1" step="1" {...register('quantity', { valueAsNumber: true, required: 'Vui lòng nhập số lượng.', validate: (value) => (typeof value === 'number' && Number.isInteger(value) && value > 0) || 'Số lượng phải là số nguyên lớn hơn 0.' })} className={inputClassName} />
              <FieldError message={errors.quantity?.message} />
            </label>
          )}
        </div>
        <label className={labelClassName}>
          <span>Lý do</span>
          <textarea rows={3} {...register('reason', { required: 'Lý do là bắt buộc.', setValueAs: (value: string) => value.trim() })} className={inputClassName} />
          <FieldError message={errors.reason?.message} />
        </label>
        <label className={labelClassName}>
          <span>Ghi chú</span>
          <textarea rows={2} {...register('note')} className={inputClassName} />
        </label>
        <FormActions busy={busy || referencesUnavailable || isUnsupportedStackAdjustment || (Boolean(selectedAreaId) && locations.items.length === 0)} onCancel={onClose} submitLabel="Tạo adjustment" />
      </form>
    </CrudModal>
  );
};
