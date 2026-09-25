import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useStockAreaScopes } from '../../hooks/useStockAreaScopes';
import type { SupplyOption } from '../../types/supplies';
import type { CreateStockAdjustmentInput, StockAdjustmentType } from '../../types/stock-transactions';
import {
  StorageLocationLabelsPicker,
  type LocationLabel,
} from '../common/StorageLocationLabelsPicker';
import { SupplyProviderSelect } from '../common/SupplyProviderSelect';
import { SelectSkeleton } from '../common/skeleton';
import { SupplyCombobox } from '../orders/SupplyCombobox';
import { CrudDrawerForm } from '../crud/CrudDrawerForm';
import { FieldError, inputClassName, labelClassName } from '../crud/CrudPrimitives';

const ADJUSTMENT_TYPES: readonly { value: StockAdjustmentType; label: string }[] = [
  { value: 'ADJUSTMENT_IN', label: 'Cộng tồn' },
  { value: 'ADJUSTMENT_OUT', label: 'Trừ tồn' },
  { value: 'IMPORT', label: 'Nhập kho' },
  { value: 'EXPORT', label: 'Xuất kho' },
];

/**
 * Body of the "create stock adjustment" drawer, shared by Stock balances and
 * Stock transactions. It owns its own server-side lookups because both pages
 * need the identical four, and keeps closing out of its hands: the drawer host
 * decides that, so an unsaved form can warn before it disappears.
 */
export const StockAdjustmentForm = ({
  busy,
  onSave,
}: {
  busy: boolean;
  onSave: (input: CreateStockAdjustmentInput) => Promise<void>;
}) => {
  // Writing is pinned to the user's own Area, so this list is usually a single
  // entry. An admin gets every Area and still has to pick one.
  const areaScopes = useStockAreaScopes();
  const { areas: scopedAreas, writableAreaId } = areaScopes.scopes;
  const writableAreas = writableAreaId
    ? scopedAreas.filter((area) => area.id === writableAreaId)
    : scopedAreas;
  // The combobox hands back the whole row, so the chosen supply is held here
  // rather than looked up again in a page of search results. The old select
  // could only resolve a selection while it happened to sit in the current 20
  // rows, which quietly broke the stack-supply branch below.
  const [selectedSupply, setSelectedSupply] = useState<SupplyOption | null>(null);
  // Labels for where the code sits. Stock is one pooled row per code, so these
  // carry no quantity and are optional.
  const [locations, setLocations] = useState<LocationLabel[]>([]);
  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors, isDirty },
  } = useForm<CreateStockAdjustmentInput>({
    defaultValues: {
      supply_id: '',
      provider_id: '',
      area_id: '',
      type: 'ADJUSTMENT_IN',
      quantity: 1,
      stack_quantity: undefined,
      set_per_qty: undefined,
      reason: '',
      note: '',
    },
  });
  const selectedAreaId = useWatch({ control, name: 'area_id' });
  const selectedSupplyId = useWatch({ control, name: 'supply_id' });
  const selectedProviderId = useWatch({ control, name: 'provider_id' });
  const selectedType = useWatch({ control, name: 'type' });
  const stackQuantity = useWatch({ control, name: 'stack_quantity' });
  const setPerQty = useWatch({ control, name: 'set_per_qty' });
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
  const areaRegistration = register('area_id', { required: 'Vui lòng chọn khu vực.' });
  // Registered without a control of their own: the comboboxes write these
  // through setValue, so validation still runs but there is no field to spread.
  register('supply_id', { required: 'Vui lòng chọn vật tư.' });
  register('provider_id', { required: 'Vui lòng chọn Provider.' });

  const pickSupply = (supply: SupplyOption | null) => {
    setSelectedSupply(supply);
    setValue('supply_id', supply?.id ?? '', { shouldValidate: true, shouldDirty: true });
    // Provider is offered per supply, and the stack fields belong to the supply's
    // category, so all three stop meaning anything the moment the supply changes.
    setValue('provider_id', '', { shouldValidate: false });
    setValue('stack_quantity', undefined, { shouldValidate: false });
    setValue('set_per_qty', undefined, { shouldValidate: false });
  };

  // A non-admin has exactly one writable Area, so asking them to choose it is
  // busywork. Left unselected for an admin, who genuinely has to decide.
  useEffect(() => {
    if (selectedAreaId || writableAreas.length !== 1) return;
    setValue('area_id', writableAreas[0].id, { shouldValidate: true });
  }, [selectedAreaId, setValue, writableAreas]);

  useEffect(() => {
    if (isStackImport) return;
    setValue('stack_quantity', undefined, { shouldValidate: false });
    setValue('set_per_qty', undefined, { shouldValidate: false });
  }, [isStackImport, setValue]);

  // Supplies and locations report their own loading and failures inside their
  // dropdowns now; only Areas is still a plain select that needs a banner.
  const referenceErrors = areaScopes.error
    ? ['Không thể tải danh sách khu vực được phép.']
    : [];
  const referencesLoading = areaScopes.loading;
  const referencesUnavailable = referencesLoading
    || referenceErrors.length > 0
    || writableAreas.length === 0;

  const submit = async (values: CreateStockAdjustmentInput) => {
    const payload: CreateStockAdjustmentInput = {
      ...values,
      location_ids: locations.map((location) => location.id),
      reason: values.reason.trim(),
      note: values.note?.trim() || null,
    };
    if (isStackImport) {
      payload.quantity = values.stack_quantity! * values.set_per_qty!;
    } else {
      delete payload.stack_quantity;
      delete payload.set_per_qty;
    }
    await onSave(payload);
  };

  // Distinct from `busy`: these block submitting without freezing the fields, so
  // the operator can still correct the selection that caused the block.
  const submitBlocked = referencesUnavailable || isUnsupportedStackAdjustment;

  return (
    <CrudDrawerForm
      isDirty={isDirty}
      busy={busy}
      submitDisabled={submitBlocked}
      onSubmit={handleSubmit(submit)}
    >
      <div className="rounded-xl border border-black-200 bg-white p-3 text-sm italic">
        Chỉnh sửa cập nhật tồn kho sẽ tạo một <span className="font-bold text-red-500">giao dịch</span> mới. Giao dịch cũ không bị sửa hoặc xóa.
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
          <SupplyCombobox
            value={selectedSupplyId}
            selectedSupply={selectedSupply}
            onChange={pickSupply}
            disabled={busy}
            ariaLabel="Chọn vật tư cho điều chỉnh tồn kho"
            error={errors.supply_id?.message}
          />
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
          {areaScopes.loading ? <SelectSkeleton label="Đang tải khu vực" /> : (
            <select
              {...areaRegistration}
              disabled={referencesLoading}
              className={inputClassName}
              onChange={(event) => {
                void areaRegistration.onChange(event);
                // Labels belong to the old Area.
                setLocations([]);
              }}
            >
              <option value="">Chọn khu vực</option>
              {writableAreas.map((area) => <option key={area.id} value={area.id}>{area.code} - {area.name}</option>)}
            </select>
          )}
          {!areaScopes.loading && writableAreas.length === 0
            ? <FieldError message="Bạn chưa được gán khu vực nào để điều chỉnh tồn kho." />
            : <FieldError message={errors.area_id?.message} />}
        </label>
        <div className={labelClassName}>
          <span>Vị trí kho (nhãn)</span>
          <StorageLocationLabelsPicker
            areaId={selectedAreaId}
            value={locations}
            onChange={setLocations}
            disabled={busy}
            ariaLabel="Gắn vị trí kho cho mã vật tư"
          />
        </div>
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
    </CrudDrawerForm>
  );
};
