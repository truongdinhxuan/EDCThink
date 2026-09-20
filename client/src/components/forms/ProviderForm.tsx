import { useForm } from 'react-hook-form';
import { CrudDrawerForm } from '../crud/CrudDrawerForm';
import { FieldError, inputClassName, labelClassName } from '../crud/CrudPrimitives';
import type { CreateProviderInput, Provider } from '../../types/providers';
const UNKNOWN_PROVIDER_CODE = 'UNKNOW';

export const ProviderForm = ({
  item,
  busy,
  onSave,
}: {
  item: Provider | null;
  busy: boolean;
  onSave: (values: CreateProviderInput) => Promise<void>;
}) => {
  const isUnknown = item?.code === UNKNOWN_PROVIDER_CODE;
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<CreateProviderInput>({
    defaultValues: {
      code: item?.code ?? '',
      name: item?.name ?? '',
      description: item?.description ?? '',
      is_active: item?.is_active ?? true,
    },
  });

  return (
    <CrudDrawerForm isDirty={isDirty} busy={busy} onSubmit={handleSubmit(onSave)} className="space-y-4">
      {isUnknown && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          UNKNOW — Chưa rõ là Provider hệ thống. Không thể đổi code hoặc deactivate.
        </div>
      )}
      <label className={labelClassName}>
        <span>Code</span>
        <input
          {...register('code', {
            required: 'Vui lòng nhập Provider code.',
            setValueAs: (value: string) => value.trim(),
          })}
          readOnly={isUnknown}
          aria-readonly={isUnknown}
          className={`${inputClassName} ${isUnknown ? 'cursor-not-allowed bg-slate-100' : ''}`}
        />
        <FieldError message={errors.code?.message} />
      </label>
      <label className={labelClassName}>
        <span>Tên Provider</span>
        <input
          {...register('name', {
            required: 'Vui lòng nhập tên Provider.',
            setValueAs: (value: string) => value.trim(),
          })}
          className={inputClassName}
        />
        <FieldError message={errors.name?.message} />
      </label>
      <label className={labelClassName}>
        <span>Mô tả</span>
        <textarea
          rows={4}
          {...register('description', {
            setValueAs: (value: string) => value.trim() || null,
          })}
          className={inputClassName}
        />
      </label>
      <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <input
          type="checkbox"
          {...register('is_active')}
          disabled={isUnknown}
          className="h-4 w-4 rounded border-slate-300"
        />
        Đang hoạt động
      </label>

    </CrudDrawerForm>
  );
};
