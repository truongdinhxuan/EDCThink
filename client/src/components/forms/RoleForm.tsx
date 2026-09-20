import { useForm } from 'react-hook-form';
import { CrudDrawerForm } from '../crud/CrudDrawerForm';
import { FieldError, inputClassName, labelClassName } from '../crud/CrudPrimitives';
import type { Role } from '../../types/roles';
export interface RoleFormValues {
  code: string;
  name: string;
  description: string;
  is_active: boolean;
}


export const RoleForm = ({ role, busy, onSave }: {
  role: Role | null;
  busy: boolean;
  onSave: (values: RoleFormValues) => Promise<void>;
}) => {
  const { register, handleSubmit, formState: { errors, isDirty } } = useForm<RoleFormValues>({
    defaultValues: {
      code: role?.code ?? '', name: role?.name ?? '',
      description: role?.description ?? '', is_active: role?.is_active ?? true,
    },
  });
  return (
    <CrudDrawerForm isDirty={isDirty} busy={busy} onSubmit={handleSubmit(onSave)} className="space-y-4">
      <label className={labelClassName}>
        <span>Code</span>
        <input {...register('code', {
          required: 'Vui lòng nhập role code.',
          pattern: { value: /^[A-Z][A-Z0-9_]*$/, message: 'Code chỉ gồm A-Z, số và dấu gạch dưới.' },
          setValueAs: (value: string) => value.trim().toUpperCase(),
        })} disabled={Boolean(role?.is_system)} className={inputClassName} />
        <FieldError message={errors.code?.message} />
      </label>
      <label className={labelClassName}>
        <span>Tên hiển thị</span>
        <input {...register('name', { required: 'Vui lòng nhập tên role.', setValueAs: (value: string) => value.trim() })} className={inputClassName} />
        <FieldError message={errors.name?.message} />
      </label>
      <label className={labelClassName}>
        <span>Mô tả</span>
        <textarea {...register('description', { setValueAs: (value: string) => value.trim() })} rows={3} className={inputClassName} />
      </label>
      <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <input type="checkbox" {...register('is_active')} disabled={Boolean(role?.is_system)} className="h-4 w-4 rounded border-slate-300" />
        Đang hoạt động
      </label>
      {role?.is_system && <p className="text-xs text-slate-500">Role hệ thống không cho phép đổi code hoặc xóa.</p>}

    </CrudDrawerForm>
  );
};
