import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { CrudDrawerForm } from '../crud/CrudDrawerForm';
import { FieldError, inputClassName, labelClassName } from '../crud/CrudPrimitives';
import { ServerCombobox } from '../common/ServerCombobox';
import { SelectSkeleton } from '../common/skeleton';
import type { UserProfile } from '../../types/users';
import type { Role } from '../../types/roles';
import type { Area } from '../../types/areas';
export interface UserFormValues {
  email: string;
  password: string;
  confirm_password: string;
  first_name: string;
  last_name: string;
  vinfast_id: string;
  phone_number: string;
  avatar_url: string;
  role_ids: string[];
  area_id: string;
  managed_by_user_id: string;
  is_active: boolean;
  is_verified: boolean;
}

export interface UserReferenceData {
  roles: Role[];
  areas: Area[];
  users: UserProfile[];
  managerSearch: string;
  setManagerSearch: (value: string) => void;
  /** Reported separately from `loading` so the manager combobox can speak for itself. */
  managersLoading: boolean;
  managersError: string | null;
  loading: boolean;
  errors: string[];
}


const managerLabel = (candidate: UserProfile): string => {
  const name = `${candidate.first_name} ${candidate.last_name}`.trim();
  return name ? `${name} (${candidate.email})` : candidate.email;
};

export const UserForm = ({ user, roleIds, canAssignRoles, references, busy, onSave }: {
  user: UserProfile | null;
  roleIds: string[];
  canAssignRoles: boolean;
  references: UserReferenceData;
  busy: boolean;
  onSave: (values: UserFormValues) => Promise<void>;
}) => {
  const {
    control,
    register,
    setValue,
    handleSubmit,
    getValues,
    formState: { errors, isDirty },
  } = useForm<UserFormValues>({
    defaultValues: {
      email: user?.email ?? '',
      password: '',
      confirm_password: '',
      first_name: user?.first_name ?? '',
      last_name: user?.last_name ?? '',
      vinfast_id: user?.vinfast_id ?? '',
      phone_number: user?.phone_number ?? '',
      avatar_url: user?.avatar_url ?? '',
      role_ids: roleIds,
      area_id: user?.area_id ?? '',
      managed_by_user_id: user?.managed_by_user_id ?? '',
      is_active: user?.is_active ?? true,
      is_verified: user?.is_verified ?? false,
    },
  });
  const referencesUnavailable = references.loading || references.errors.length > 0
    || references.roles.length === 0 || references.areas.length === 0;

  const managerId = useWatch({ control, name: 'managed_by_user_id' });
  const [pickedManager, setPickedManager] = useState<UserProfile | null>(null);
  // Nobody may manage themselves, and an inactive account cannot be given reports.
  const managerOptions = references.users.filter(
    (candidate) => candidate.id !== user?.id && candidate.is_active,
  );
  // On an existing user the id arrives without the row, so fall back to naming it
  // from whatever the manager search has loaded.
  const selectedManager = pickedManager?.id === managerId
    ? pickedManager
    : managerOptions.find((candidate) => candidate.id === managerId) ?? null;

  const pickManager = (candidate: UserProfile | null) => {
    setPickedManager(candidate);
    setValue('managed_by_user_id', candidate?.id ?? '', { shouldDirty: true });
  };

  return (
    <CrudDrawerForm isDirty={isDirty} busy={busy} submitDisabled={referencesUnavailable} onSubmit={handleSubmit(onSave)} className="space-y-5">
      {references.errors.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {references.errors.map((message) => <p key={message}>{message}</p>)}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClassName}>
          <span>Họ</span>
          <input {...register('first_name', { required: 'Vui lòng nhập họ.', setValueAs: (value: string) => value.trim() })} className={inputClassName} />
          <FieldError message={errors.first_name?.message} />
        </label>
        <label className={labelClassName}>
          <span>Tên</span>
          <input {...register('last_name', { required: 'Vui lòng nhập tên.', setValueAs: (value: string) => value.trim() })} className={inputClassName} />
          <FieldError message={errors.last_name?.message} />
        </label>
        <label className={labelClassName}>
          <span>Email</span>
          <input type="email" autoComplete="off" {...register('email', { required: 'Vui lòng nhập email.', setValueAs: (value: string) => value.trim().toLowerCase() })} className={inputClassName} />
          <FieldError message={errors.email?.message} />
        </label>
        <label className={labelClassName}>
          <span>VinFast ID</span>
          <input type="text" inputMode="numeric" {...register('vinfast_id', { required: 'Vui lòng nhập VinFast ID.' })} className={inputClassName} />
          <FieldError message={errors.vinfast_id?.message} />
        </label>
        {!user && (
          <>
            <label className={labelClassName}>
              <span>Mật khẩu ban đầu</span>
              <input type="password" autoComplete="new-password" {...register('password', {
                required: 'Vui lòng nhập mật khẩu.',
                minLength: { value: 9, message: 'Mật khẩu phải có ít nhất 9 ký tự.' },
                maxLength: { value: 128, message: 'Mật khẩu không được vượt quá 128 ký tự.' },
                validate: (value) =>
                  (/[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value))
                  || 'Mật khẩu cần có chữ hoa, số và ký tự đặc biệt.',
              })} className={inputClassName} />
              <FieldError message={errors.password?.message} />
            </label>
            <label className={labelClassName}>
              <span>Xác nhận mật khẩu</span>
              <input type="password" autoComplete="new-password" {...register('confirm_password', { required: 'Vui lòng xác nhận mật khẩu.', validate: (value) => value === getValues('password') || 'Mật khẩu xác nhận không khớp.' })} className={inputClassName} />
              <FieldError message={errors.confirm_password?.message} />
            </label>
          </>
        )}
        <fieldset className={`${labelClassName} rounded-xl border border-slate-200 p-3`}>
          <legend className="px-1">Roles</legend>
          {references.loading && references.roles.length === 0 ? <SelectSkeleton label="Đang tải role" /> : (
            <div className="max-h-40 space-y-2 overflow-y-auto">
              {references.roles.map((role) => (
                <label key={role.id} className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input type="checkbox" value={role.id} disabled={!canAssignRoles}
                    {...register('role_ids', { required: 'Vui lòng chọn ít nhất một role.' })}
                    className="h-4 w-4 rounded border-slate-300" />
                  {role.name} ({role.code})
                </label>
              ))}
            </div>
          )}
          {!references.loading && references.roles.length === 0 ? <FieldError message="Không có role để lựa chọn." /> : <FieldError message={errors.role_ids?.message} />}
        </fieldset>
        <label className={labelClassName}>
          <span>Area</span>
          {references.loading && references.areas.length === 0 ? <SelectSkeleton label="Đang tải area" /> : <select {...register('area_id', { required: 'Vui lòng chọn area.' })} className={inputClassName}>
            <option value="">Chọn area</option>
            {references.areas.map((area) => <option key={area.id} value={area.id}>{area.code} - {area.name}</option>)}
          </select>}
          {!references.loading && references.areas.length === 0 ? <FieldError message="Không có area active để lựa chọn." /> : <FieldError message={errors.area_id?.message} />}
        </label>
        <label className={labelClassName}>
          <span>Người quản lý</span>
          <ServerCombobox<UserProfile>
            value={managerId}
            selected={selectedManager}
            items={managerOptions}
            search={references.managerSearch}
            setSearch={references.setManagerSearch}
            loading={references.managersLoading}
            lookupError={references.managersError}
            onChange={pickManager}
            getLabel={managerLabel}
            renderOption={(candidate) => (
              <span className="min-w-0">
                <span className="block truncate font-semibold">
                  {`${candidate.first_name} ${candidate.last_name}`.trim()}
                </span>
                <span className="block truncate text-xs text-slate-500">{candidate.email}</span>
              </span>
            )}
            placeholder="Nhập tên hoặc email người quản lý…"
            loadingText="Đang tải người quản lý…"
            emptyText="Không có người quản lý phù hợp."
            noMatchText="Không tìm thấy người quản lý."
            clearLabel="Bỏ chọn người quản lý"
            ariaLabel="Chọn người quản lý"
          />
        </label>
        <label className={labelClassName}>
          <span>Số điện thoại</span>
          <input type="tel" {...register('phone_number')} className={inputClassName} />
        </label>
        <label className={labelClassName}>
          <span>Avatar URL</span>
          <input type="url" {...register('avatar_url')} className={inputClassName} />
        </label>
      </div>
      {user && (
        <div className="flex flex-wrap gap-5 rounded-xl bg-slate-50 p-4">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" {...register('is_active')} className="h-4 w-4 rounded border-slate-300" /> Đang hoạt động</label>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" {...register('is_verified')} className="h-4 w-4 rounded border-slate-300" /> Đã duyệt tài khoản</label>
        </div>
      )}

    </CrudDrawerForm>
  );
};
