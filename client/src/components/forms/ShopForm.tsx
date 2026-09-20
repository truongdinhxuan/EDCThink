import { useForm } from 'react-hook-form';
import { CrudDrawerForm } from '../crud/CrudDrawerForm';
import { FieldError, inputClassName, labelClassName } from '../crud/CrudPrimitives';
import type { MilkrunShop, MilkrunShopInput } from '../../types/milkrun';

export const ShopForm = ({
  item,
  busy,
  onSave,
}: {
  item: MilkrunShop | null;
  busy: boolean;
  onSave: (values: MilkrunShopInput) => Promise<void>;
}) => {
  const { register, handleSubmit, formState: { errors, isDirty } } = useForm<MilkrunShopInput>({
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
          className={inputClassName}
          autoFocus
        />
        <FieldError message={errors.code?.message} />
      </label>

      <label className={labelClassName}>
        Tên Shop *
        <input
          {...register('name', {
            required: 'Vui lòng nhập tên Shop.',
            maxLength: { value: 255, message: 'Tên Shop tối đa 255 ký tự.' },
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

      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input type="checkbox" {...register('is_active')} />
        Đang hoạt động
      </label>


    </CrudDrawerForm>
  );
};
