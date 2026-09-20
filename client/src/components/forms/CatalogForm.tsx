import { useForm } from 'react-hook-form';
import { CrudDrawerForm } from '../crud/CrudDrawerForm';
import { FieldError, inputClassName, labelClassName } from '../crud/CrudPrimitives';
import type { MilkrunTripType, MilkrunTripStatusRecord, MilkrunTripTypeInput } from '../../types/milkrun';
export type ResourceName = 'trip-types' | 'trip-statuses';
export type CatalogItem = MilkrunTripType | MilkrunTripStatusRecord;
export interface CatalogFormValues extends MilkrunTripTypeInput {
  sort_order?: number;
}


export const CatalogForm = ({
  resourceName,
  item,
  busy,
  onSave,
}: {
  resourceName: ResourceName;
  item: CatalogItem | null;
  busy: boolean;
  onSave: (values: CatalogFormValues) => Promise<void>;
}) => {
  const isStatus = resourceName === 'trip-statuses';
  const statusItem = item && 'sort_order' in item ? item : null;
  const { register, handleSubmit, formState: { errors, isDirty } } = useForm<CatalogFormValues>({
    defaultValues: {
      code: item?.code ?? '',
      name: item?.name ?? '',
      description: item?.description ?? '',
      is_active: item?.is_active ?? true,
      sort_order: statusItem?.sort_order ?? 0,
    },
  });

  return (
    <CrudDrawerForm isDirty={isDirty} busy={busy} onSubmit={handleSubmit(onSave)} className="space-y-4">
      <label className={labelClassName}>
        Code *
        <input
          {...register('code', {
            required: 'Vui lòng nhập code.',
            maxLength: { value: 100, message: 'Code tối đa 100 ký tự.' },
            pattern: {
              value: /^[A-Za-z][A-Za-z0-9_]*$/,
              message: 'Code phải bắt đầu bằng chữ và chỉ gồm chữ, số hoặc dấu gạch dưới.',
            },
          })}
          className={`${inputClassName} ${item?.is_system ? 'bg-slate-100' : ''}`}
          readOnly={item?.is_system}
          aria-readonly={item?.is_system}
          autoFocus={!item?.is_system}
        />
        <FieldError message={errors.code?.message} />
        {item?.is_system && (
          <span className="text-xs font-normal text-slate-500">Code hệ thống không thể thay đổi.</span>
        )}
      </label>

      <label className={labelClassName}>
        Tên *
        <input
          {...register('name', {
            required: 'Vui lòng nhập tên.',
            maxLength: { value: 255, message: 'Tên tối đa 255 ký tự.' },
          })}
          className={inputClassName}
        />
        <FieldError message={errors.name?.message} />
      </label>

      <label className={labelClassName}>
        Mô tả
        <textarea
          {...register('description', {
            maxLength: { value: 2000, message: 'Mô tả tối đa 2000 ký tự.' },
          })}
          className={`${inputClassName} min-h-28 resize-y`}
        />
        <FieldError message={errors.description?.message} />
      </label>

      {isStatus && (
        <label className={labelClassName}>
          Thứ tự *
          <input
            type="number"
            min={0}
            step={1}
            {...register('sort_order', {
              required: 'Vui lòng nhập thứ tự.',
              valueAsNumber: true,
              min: { value: 0, message: 'Thứ tự không được âm.' },
            })}
            className={inputClassName}
          />
          <FieldError message={errors.sort_order?.message} />
        </label>
      )}

      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          {...register('is_active')}
          disabled={item?.is_system}
        />
        Đang hoạt động
      </label>


    </CrudDrawerForm>
  );
};
