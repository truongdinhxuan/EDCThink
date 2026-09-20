import { useForm } from 'react-hook-form';
import { CrudDrawerForm } from '../crud/CrudDrawerForm';
import { FieldError, inputClassName, labelClassName } from '../crud/CrudPrimitives';
import type { MilkrunRack, MilkrunRackInput } from '../../types/milkrun';

export const RackForm = ({
  item,
  busy,
  onSave,
}: {
  item: MilkrunRack | null;
  busy: boolean;
  onSave: (values: MilkrunRackInput) => Promise<void>;
}) => {
  const { register, handleSubmit, formState: { errors, isDirty } } = useForm<MilkrunRackInput>({
    defaultValues: {
      code: item?.code ?? '',
      name: item?.name ?? '',
      image_url: item?.image_url ?? '',
      is_active: item?.is_active ?? true,
    },
  });

  return (
    <CrudDrawerForm isDirty={isDirty} busy={busy} onSubmit={handleSubmit(onSave)} className="space-y-4">
      <label className={labelClassName}>
        Code *
        <input
          {...register('code', { required: 'Vui lòng nhập code.' })}
          className={inputClassName}
          autoFocus
        />
        <FieldError message={errors.code?.message} />
      </label>
      <label className={labelClassName}>
        Tên rack *
        <input
          {...register('name', { required: 'Vui lòng nhập tên rack.' })}
          className={inputClassName}
        />
        <FieldError message={errors.name?.message} />
      </label>
      <label className={labelClassName}>
        Image URL
        <input {...register('image_url')} className={inputClassName} placeholder="https://..." />
      </label>
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input type="checkbox" {...register('is_active')} />
        Đang hoạt động
      </label>

    </CrudDrawerForm>
  );
};
