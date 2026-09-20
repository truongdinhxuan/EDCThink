import { useForm } from 'react-hook-form';
import { CrudDrawerForm } from '../crud/CrudDrawerForm';
import { FieldError, inputClassName, labelClassName } from '../crud/CrudPrimitives';
import type { CreateSupplyCategoryInput, SupplyCategory } from '../../types/supply-categories';

export const SupplyCategoryForm = ({ item, busy, onSave }: {
  item: SupplyCategory | null;
  busy: boolean;
  onSave: (values: CreateSupplyCategoryInput) => Promise<void>;
}) => {
  const { register, handleSubmit, formState: { errors, isDirty } } = useForm<CreateSupplyCategoryInput>({
    defaultValues: {
      code: item?.code ?? '',
      name: item?.name ?? '',
      description: item?.description ?? '',
      is_active: item?.is_active ?? true,
    },
  });
  return (
    <CrudDrawerForm isDirty={isDirty} busy={busy} onSubmit={handleSubmit(onSave)} className="space-y-4">
      <label className={labelClassName}>
        <span>Mã danh mục</span>
        <input {...register('code', { required: 'Vui lòng nhập mã danh mục.', setValueAs: (value: string) => value.trim() })} className={inputClassName} />
        <FieldError message={errors.code?.message} />
      </label>
      <label className={labelClassName}>
        <span>Tên danh mục</span>
        <input
          {...register('name', {
            required: 'Vui lòng nhập tên danh mục.',
            setValueAs: (value: string) => value.trim(),
          })}
          className={inputClassName}
        />
        <FieldError message={errors.name?.message} />
      </label>
      <label className={labelClassName}>
        <span>Mô tả</span>
        <textarea rows={3} {...register('description', { setValueAs: (value: string) => value.trim() || null })} className={inputClassName} />
      </label>
      <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <input type="checkbox" {...register('is_active')} className="h-4 w-4 rounded border-slate-300" />
        Đang hoạt động
      </label>

    </CrudDrawerForm>
  );
};
