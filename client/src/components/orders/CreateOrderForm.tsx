import {
  createRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { getApiErrorMessage } from '../../api/errors';
import { createOrder } from '../../api/orders.service';
import { useAuth } from '../../context/AuthContext';
import { useAreaLookup } from '../../hooks/useAreaLookup';
import type { SupplyOption } from '../../types/catalog';
import type { CreateOrderInput, Order } from '../../types/orders';
import type { ShiftOrderSheetCreateContext } from '../../types/shift-order-sheets';
import { InfoButton, SecondaryButton, TextErrorButton } from '../common/Button';
import { SupplyProviderSelect } from '../common/SupplyProviderSelect';
import { OrderItemAvailability } from './OrderItemAvailability';
import { OrderStackFields } from './OrderStackFields';
import { SupplyCombobox } from './SupplyCombobox';

interface CreateOrderFormValues {
  note: string;
  order_list: Array<{
    supply_id: string;
    provider_id: string;
    unit_id: string;
    quantity_requested?: number;
    set_per_qty?: number;
    requested_stack_quantity?: number;
    requested_total_set_quantity?: number;
    note: string;
  }>;
}

export interface CreateOrderFormState {
  stage: 'editing' | 'creating' | 'success' | 'create-failed';
  isDirty: boolean;
  isBusy: boolean;
}

interface CreateOrderFormProps {
  formId: string;
  sheetContext?: ShiftOrderSheetCreateContext | null;
  compact?: boolean;
  showInlineActions?: boolean;
  initialFocusRef?: RefObject<HTMLInputElement | null>;
  onCancel?: () => void;
  onSuccess: (order: Order) => void | Promise<void>;
  onStateChange?: (state: CreateOrderFormState) => void;
}

const ORDER_SOURCE_AREA_CODE = 'VTDG';

const emptyItem = () => ({
  supply_id: '',
  provider_id: '',
  unit_id: '',
  quantity_requested: 1,
  set_per_qty: undefined,
  requested_stack_quantity: undefined,
  requested_total_set_quantity: undefined,
  note: '',
});

const formatWorkDate = (value: string): string => {
  const date = new Date(`${value}T00:00:00+07:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
};

const shiftLabel = (context: ShiftOrderSheetCreateContext): string => {
  const label = context.work_shift?.name || context.work_shift?.code || 'Không xác định';
  return label.replace(/^ca\s+/i, '').trim() || context.work_shift?.code || 'Không xác định';
};

export const CreateOrderForm = ({
  formId,
  sheetContext = null,
  compact = false,
  showInlineActions = false,
  initialFocusRef,
  onCancel,
  onSuccess,
  onStateChange,
}: CreateOrderFormProps) => {
  const { user } = useAuth();
  const receivingAreaId = user?.publicData.area_id ?? '';
  // Each SupplyCombobox owns its own server search; we only need to remember the
  // full option for supplies the operator has actually picked, so unit/category
  // derivation and the payload builder can resolve them without a shared list.
  const [resolvedSupplies, setResolvedSupplies] = useState<Record<string, SupplyOption>>({});
  const rememberSupply = useCallback((supply: SupplyOption | null) => {
    if (!supply) return;
    setResolvedSupplies((current) =>
      current[supply.id] ? current : { ...current, [supply.id]: supply });
  }, []);
  const areaResource = useAreaLookup();
  const areas = areaResource.items;
  const sourceArea = areas.find((area) => area.code === ORDER_SOURCE_AREA_CODE);
  const receivingArea = user?.publicData.area
    ?? areas.find((area) => area.id === receivingAreaId);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [stage, setStage] = useState<CreateOrderFormState['stage']>('editing');

  const {
    control,
    register,
    handleSubmit,
    setValue,
    setFocus,
    formState: { errors, isDirty },
  } = useForm<CreateOrderFormValues>({
    defaultValues: { note: '', order_list: [emptyItem()] },
    shouldFocusError: true,
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'order_list' });
  const orderItems = useWatch({ control, name: 'order_list' });
  const previousSourceAreaId = useRef('');

  // Per-row DOM handles so focus can progress Supply -> Provider -> Quantity
  // without the operator reaching for the mouse. Quantity uses RHF's setFocus.
  const rowCount = fields.length;
  const supplyInputRefs = useMemo(
    () => Array.from({ length: rowCount }, () => createRef<HTMLInputElement>()),
    [rowCount],
  );
  const providerSelectRefs = useMemo(
    () => Array.from({ length: rowCount }, () => createRef<HTMLSelectElement>()),
    [rowCount],
  );
  const stackSelectRefs = useMemo(
    () => Array.from({ length: rowCount }, () => createRef<HTMLSelectElement>()),
    [rowCount],
  );
  const pendingProviderFocusRef = useRef<number | null>(null);
  const previousFieldCount = useRef(fields.length);

  const isBusy = stage === 'creating';

  useEffect(() => {
    onStateChange?.({
      stage,
      isDirty,
      isBusy,
    });
  }, [isBusy, isDirty, onStateChange, stage]);

  // Focus the freshly appended material row's Supply search (P0: add-row flow).
  useEffect(() => {
    if (fields.length > previousFieldCount.current) {
      const nextIndex = fields.length - 1;
      window.requestAnimationFrame(() => supplyInputRefs[nextIndex]?.current?.focus());
    }
    previousFieldCount.current = fields.length;
  }, [fields.length, supplyInputRefs]);

  const resetStackFields = useCallback((index: number) => {
    setValue(`order_list.${index}.set_per_qty`, undefined, { shouldValidate: false });
    setValue(`order_list.${index}.requested_stack_quantity`, undefined, { shouldValidate: false });
    setValue(`order_list.${index}.requested_total_set_quantity`, undefined, { shouldValidate: false });
  }, [setValue]);

  useEffect(() => {
    const nextAreaId = sourceArea?.id ?? '';
    if (
      previousSourceAreaId.current
      && nextAreaId
      && previousSourceAreaId.current !== nextAreaId
    ) {
      fields.forEach((_, index) => resetStackFields(index));
    }
    previousSourceAreaId.current = nextAreaId;
  }, [fields, resetStackFields, sourceArea?.id]);

  const changeSupply = (index: number, supply: SupplyOption | null) => {
    rememberSupply(supply);
    setValue(`order_list.${index}.supply_id`, supply?.id ?? '', { shouldValidate: true, shouldDirty: true });
    setValue(`order_list.${index}.provider_id`, '', { shouldValidate: false, shouldDirty: true });
    setValue(`order_list.${index}.unit_id`, supply?.unit_id ?? '', { shouldValidate: true, shouldDirty: true });
    setValue(
      `order_list.${index}.quantity_requested`,
      supply?.category?.code === 'KIEN_SAT_TC' ? undefined : 1,
      { shouldValidate: false, shouldDirty: true },
    );
    resetStackFields(index);
  };

  const focusAfterProvider = (index: number, providerCount: number) => {
    const supplyId = orderItems?.[index]?.supply_id;
    const isStack = supplyId
      ? resolvedSupplies[supplyId]?.category?.code === 'KIEN_SAT_TC'
      : false;
    window.requestAnimationFrame(() => {
      if (isStack) {
        const stackTarget = stackSelectRefs[index]?.current;
        if (stackTarget) {
          stackTarget.focus();
          return;
        }
        // Stack options may still be loading; retry once, else land on Provider.
        window.setTimeout(() => {
          (stackSelectRefs[index]?.current ?? providerSelectRefs[index]?.current)?.focus();
        }, 250);
        return;
      }
      if (providerCount > 1 && providerSelectRefs[index]?.current) {
        providerSelectRefs[index]!.current!.focus();
        return;
      }
      setFocus(`order_list.${index}.quantity_requested`);
    });
  };

  const handleSupplySelected = (index: number) => {
    pendingProviderFocusRef.current = index;
  };

  const handleProviderResolve = (
    index: number,
    info: { providerCount: number; autoSelected: boolean },
  ) => {
    if (pendingProviderFocusRef.current !== index) return;
    pendingProviderFocusRef.current = null;
    focusAfterProvider(index, info.autoSelected ? 1 : info.providerCount);
  };

  const changeProvider = (index: number, providerId: string) => {
    setValue(`order_list.${index}.provider_id`, providerId, { shouldValidate: true, shouldDirty: true });
    resetStackFields(index);
  };

  const changeSetPerQty = (index: number, value: number | undefined) => {
    const requestedStacks = orderItems[index]?.requested_stack_quantity;
    setValue(`order_list.${index}.set_per_qty`, value, { shouldValidate: true, shouldDirty: true });
    const total = value && requestedStacks ? value * requestedStacks : undefined;
    setValue(`order_list.${index}.requested_total_set_quantity`, total, { shouldDirty: true });
    setValue(`order_list.${index}.quantity_requested`, total, { shouldValidate: true, shouldDirty: true });
  };

  const changeRequestedStackQuantity = (index: number, value: number | undefined) => {
    const setPerQty = orderItems[index]?.set_per_qty;
    setValue(`order_list.${index}.requested_stack_quantity`, value, { shouldValidate: true, shouldDirty: true });
    const total = value && setPerQty ? setPerQty * value : undefined;
    setValue(`order_list.${index}.requested_total_set_quantity`, total, { shouldDirty: true });
    setValue(`order_list.${index}.quantity_requested`, total, { shouldValidate: true, shouldDirty: true });
  };

  const buildPayload = (values: CreateOrderFormValues): CreateOrderInput => ({
    from_area_id: sourceArea!.id,
    to_area_id: receivingAreaId,
    ...(sheetContext?.id ? { shift_order_sheet_id: sheetContext.id } : {}),
    note: values.note.trim() || undefined,
    order_list: values.order_list.map((item) => {
      const supply = resolvedSupplies[item.supply_id];
      const isStack = supply?.category?.code === 'KIEN_SAT_TC';
      const setPerQty = Number(item.set_per_qty);
      const requestedStacks = Number(item.requested_stack_quantity);
      const requestedTotal = isStack ? setPerQty * requestedStacks : undefined;
      return {
        supply_id: item.supply_id.trim(),
        provider_id: item.provider_id.trim(),
        unit_id: item.unit_id.trim(),
        quantity_requested: isStack ? requestedTotal! : Number(item.quantity_requested),
        ...(isStack ? {
          set_per_qty: setPerQty,
          requested_stack_quantity: requestedStacks,
          requested_total_set_quantity: requestedTotal,
        } : {}),
        note: item.note.trim() || undefined,
      };
    }),
  });

  const validateReferences = (): string | null => {
    if (!receivingAreaId) return 'Tài khoản chưa có area_id nên không thể tạo order.';
    if (areaResource.loading || areaResource.error || areas.length === 0) {
      return 'Danh sách area chưa sẵn sàng. Vui lòng tải lại và thử lại.';
    }
    if (!sourceArea) return `Không tìm thấy Area gửi active có code ${ORDER_SOURCE_AREA_CODE}.`;
    if (!areas.some((area) => area.id === receivingAreaId)) {
      return 'Area của tài khoản không còn active hoặc không hợp lệ.';
    }
    if (sheetContext && sheetContext.area_id !== receivingAreaId) {
      return 'Phiếu Order Ca không thuộc Area của tài khoản hiện tại.';
    }
    return null;
  };

  const onSubmit = async (values: CreateOrderFormValues) => {
    if (isBusy) return;
    setSubmitError(null);

    const referenceError = validateReferences();
    if (referenceError) {
      setSubmitError(referenceError);
      return;
    }

    try {
      setStage('creating');
      const created = await createOrder(buildPayload(values));
      setStage('success');
      await onSuccess(created);
    } catch (requestError) {
      setStage('create-failed');
      setSubmitError(getApiErrorMessage(requestError, 'Không thể tạo và gửi Order.'));
    }
  };

  const referenceUnavailable = areaResource.loading
    || Boolean(areaResource.error)
    || areas.length === 0
    || !sourceArea
    || !receivingAreaId
    || Boolean(sheetContext && sheetContext.area_id !== receivingAreaId);

  // P0: no plain-Enter global submit; Ctrl/Cmd+Enter sends the Order.
  const handleFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Enter') return;
    const target = event.target as HTMLElement;
    const tag = target.tagName;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      if (!isBusy && !referenceUnavailable) {
        void handleSubmit(onSubmit)();
      }
      return;
    }
    if (tag === 'INPUT') event.preventDefault();
  };

  const hasActionableItem = (orderItems ?? []).some((item) => {
    if (!item?.supply_id) return false;
    const supply = resolvedSupplies[item.supply_id];
    if (supply?.category?.code === 'KIEN_SAT_TC') {
      return Boolean(item.set_per_qty) && Boolean(item.requested_stack_quantity);
    }
    return Number(item.quantity_requested) > 0;
  });

  const contextRow = sheetContext ? (
    <>
      <span className="font-semibold text-slate-900">Ca {shiftLabel(sheetContext)}</span>
      <span aria-hidden="true">·</span>
      <span>{formatWorkDate(sheetContext.work_date)}</span>
      <span aria-hidden="true">·</span>
      <span>{sheetContext.area?.code ?? receivingArea?.code ?? '—'}</span>
    </>
  ) : (
    <>
      <span>Gửi <span className="font-semibold text-slate-900">{sourceArea?.code ?? ORDER_SOURCE_AREA_CODE}</span></span>
      <span aria-hidden="true">→</span>
      <span>Nhận <span className="font-semibold text-slate-900">{receivingArea?.code ?? '—'}</span></span>
    </>
  );

  return (
    <form
      id={formId}
      onSubmit={handleSubmit(onSubmit)}
      onKeyDown={handleFormKeyDown}
      className="space-y-4"
      noValidate
    >
      {/* Compact, non-focusable context. Area gửi / Area nhận / ca / ngày are
          locked by the Sheet and re-checked server-side during atomic create. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
        {contextRow}
        <span className="w-full text-xs text-slate-400">
          Area gửi/nhận khóa theo phiếu; backend kiểm tra lại khi tạo Order.
        </span>
        {areaResource.error && (
          <span className="w-full text-xs text-rose-600">{areaResource.error}</span>
        )}
      </div>

      <fieldset disabled={isBusy} className="space-y-4 disabled:opacity-75">
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900">Vật tư yêu cầu</h2>
            <p className="text-xs text-slate-500">Mỗi dòng cần Supply, Provider và số lượng &gt; 0.</p>
          </div>

          <div className="@container mt-3 space-y-3">
            {fields.map((field, index) => {
              const current = orderItems[index] ?? emptyItem();
              const selectedSupply = current.supply_id
                ? resolvedSupplies[current.supply_id] ?? null
                : null;
              const isStack = selectedSupply?.category?.code === 'KIEN_SAT_TC';
              const unitLabel = selectedSupply?.unit
                ? selectedSupply.unit.symbol || selectedSupply.unit.code
                : null;
              const qtyRegister = register(`order_list.${index}.quantity_requested`, {
                valueAsNumber: true,
                required: 'Nhập số lượng.',
                min: { value: 1, message: 'Số lượng phải từ 1 trở lên.' },
                validate: (val) => Number.isInteger(Number(val)) || 'Số lượng phải là số nguyên.',
              });
              return (
                <div key={field.id} className="rounded-xl border border-slate-200 p-3">
                  <div className={`grid gap-2 @lg:items-start ${isStack ? '@lg:grid-cols-2' : '@lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1.4fr)_minmax(0,0.9fr)]'}`}>
                    <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Vật tư
                      <SupplyCombobox
                        value={current.supply_id}
                        selectedSupply={selectedSupply}
                        onChange={(supply) => changeSupply(index, supply)}
                        onSelected={() => handleSupplySelected(index)}
                        ariaLabel={`Chọn vật tư cho dòng ${index + 1}`}
                        autoFocusFlag={index === 0}
                        inputRef={index === 0 && initialFocusRef ? initialFocusRef : supplyInputRefs[index]}
                        error={errors.order_list?.[index]?.supply_id?.message}
                      />
                      <input type="hidden" {...register(`order_list.${index}.supply_id`, { required: 'Chọn vật tư.' })} />
                    </label>

                    <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Provider
                      <SupplyProviderSelect
                        supplyId={current.supply_id}
                        value={current.provider_id}
                        onChange={(providerId) => changeProvider(index, providerId)}
                        onResolve={(info) => handleProviderResolve(index, info)}
                        selectRef={providerSelectRefs[index]}
                        autoSelectSingle
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal normal-case text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100"
                        ariaLabel={`Chọn Provider cho dòng ${index + 1}`}
                      />
                      <input type="hidden" {...register(`order_list.${index}.provider_id`, { required: 'Chọn Provider.' })} />
                      {errors.order_list?.[index]?.provider_id && <span className="block normal-case text-rose-600">{errors.order_list[index]?.provider_id?.message}</span>}
                    </label>

                    <input type="hidden" {...register(`order_list.${index}.unit_id`, { required: 'Vật tư chưa có Unit.' })} />

                    {isStack ? (
                      <>
                        <input type="hidden" {...register(`order_list.${index}.set_per_qty`, { required: 'Chọn SET/chồng.', min: { value: 1, message: 'Phải từ 1 trở lên.' }, validate: (val) => Number.isInteger(Number(val)) || 'SET/chồng phải là số nguyên.' })} />
                        <input type="hidden" {...register(`order_list.${index}.requested_stack_quantity`, { required: 'Nhập số chồng.', min: { value: 1, message: 'Phải từ 1 trở lên.' }, validate: (val) => Number.isInteger(Number(val)) || 'Số chồng phải là số nguyên.' })} />
                        <input type="hidden" {...register(`order_list.${index}.requested_total_set_quantity`)} />
                        <input type="hidden" {...register(`order_list.${index}.quantity_requested`, { required: 'Tổng SET chưa hợp lệ.', min: { value: 1, message: 'Phải từ 1 trở lên.' }, validate: (val) => Number.isInteger(Number(val)) || 'Tổng SET phải là số nguyên.' })} />
                      </>
                    ) : (
                      <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <span>Số lượng{unitLabel ? <span className="ml-1 normal-case text-slate-400">({unitLabel})</span> : null}</span>
                        <input
                          type="number"
                          step="1"
                          min="1"
                          {...qtyRegister}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800"
                        />
                        {errors.order_list?.[index]?.quantity_requested && <span className="block normal-case text-rose-600">{errors.order_list[index]?.quantity_requested?.message}</span>}
                        <OrderItemAvailability
                          supplyId={current.supply_id}
                          providerId={current.provider_id}
                          areaId={sourceArea?.id ?? ''}
                          quantityRequested={current.quantity_requested}
                          enabled={!isStack}
                        />
                      </label>
                    )}
                  </div>

                  {isStack && (
                    <div className="mt-2">
                      <OrderStackFields
                        compact={compact}
                        supplyId={current.supply_id}
                        providerId={current.provider_id}
                        areaId={sourceArea?.id ?? ''}
                        setPerQty={current.set_per_qty}
                        requestedStackQuantity={current.requested_stack_quantity}
                        onSetPerQtyChange={(value) => changeSetPerQty(index, value)}
                        onRequestedStackQuantityChange={(value) => changeRequestedStackQuantity(index, value)}
                        setPerQtyError={errors.order_list?.[index]?.set_per_qty?.message}
                        requestedStackQuantityError={errors.order_list?.[index]?.requested_stack_quantity?.message}
                        setPerQtySelectRef={stackSelectRefs[index]}
                      />
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      {...register(`order_list.${index}.note`)}
                      placeholder="Ghi chú dòng (không bắt buộc)"
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-normal normal-case text-slate-800"
                    />
                    <button
                      type="button"
                      disabled={fields.length === 1}
                      onClick={() => remove(index)}
                      className={TextErrorButton}
                    >
                      Xóa dòng
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => append(emptyItem())}
            className={`${SecondaryButton} mt-3 w-full border-dashed`}
          >
            + Thêm mã vật tư
          </button>
        </div>

        <details className="rounded-2xl border border-slate-200 bg-white p-3 text-sm shadow-sm sm:p-4">
          <summary className="cursor-pointer select-none font-semibold text-slate-700">
            Ghi chú Order (không bắt buộc)
          </summary>
          <textarea
            {...register('note')}
            rows={3}
            className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </details>
      </fieldset>

      {!hasActionableItem && (
        <p className="text-xs text-slate-500">Chọn mã vật tư và nhập số lượng để gửi Order.</p>
      )}

      {submitError && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{submitError}</div>
      )}

      {showInlineActions && (
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
          {onCancel && <button type="button" onClick={onCancel} disabled={isBusy} className={`${SecondaryButton} w-full sm:w-auto`}>Hủy</button>}
          <div className="sm:text-right">
            <button type="submit" disabled={isBusy || referenceUnavailable} className={`${InfoButton} w-full sm:w-auto`}>
              {isBusy ? 'Đang gửi...' : 'Gửi Order'}
            </button>
            <span className="mt-1 block text-xs text-slate-400">Ctrl + Enter</span>
          </div>
        </div>
      )}
    </form>
  );
};
