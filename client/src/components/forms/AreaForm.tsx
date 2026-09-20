import { useForm } from 'react-hook-form';
import { CrudDrawerForm } from '../crud/CrudDrawerForm';
import { FieldError, inputClassName, labelClassName } from '../crud/CrudPrimitives';
import type { Area, CreateAreaInput } from '../../types/areas';
import type { AreaTypeSummary } from '../../types/area-scopes';
import { SelectSkeleton } from '../common/skeleton';

export const AreaForm = ({ area, areaTypes, areaTypesLoading, areaTypesError, busy, onSave }: {
  area: Area | null; busy: boolean;
  areaTypes: AreaTypeSummary[];
  areaTypesLoading: boolean;
  areaTypesError: string | null;
  onSave: (values: CreateAreaInput) => Promise<void>;
}) => {
  const { register, handleSubmit, formState: { errors, isDirty } } = useForm<CreateAreaInput>({
    defaultValues: {
      code: area?.code ?? '',
      name: area?.name ?? '',
      description: area?.description ?? '',
      area_type_id: area?.area_type_id ?? null,
      is_active: area?.is_active ?? true,
    },
  });
  return (
    <CrudDrawerForm isDirty={isDirty} busy={busy} onSubmit={handleSubmit(onSave)} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClassName}>
          <span>Mã khu vực</span>
          <input {...register('code', { required: 'Vui lòng nhập mã khu vực.', setValueAs: (value: string) => value.trim() })} className={inputClassName} />
          <FieldError message={errors.code?.message} />
        </label>
        <label className={labelClassName}>
          <span>Tên khu vực</span>
          <input {...register('name', { required: 'Vui lòng nhập tên khu vực.', setValueAs: (value: string) => value.trim() })} className={inputClassName} />
          <FieldError message={errors.name?.message} />
        </label>
      </div>
      <label className={labelClassName}>
        <span>Area Type</span>
        {areaTypesLoading && areaTypes.length === 0 ? (
          <SelectSkeleton label="Đang tải Area Type" />
        ) : (
          <select
            {...register('area_type_id', {
              setValueAs: (value: string) => value || null,
            })}
            disabled={Boolean(areaTypesError)}
            className={inputClassName}
          >
            <option value="">Chưa phân loại</option>
            {areaTypes.map((areaType) => (
              <option key={areaType.id} value={areaType.id}>
                {areaType.code} — {areaType.name}
              </option>
            ))}
          </select>
        )}
        {areaTypesError && <FieldError message={`Không tải được Area Type: ${areaTypesError}`} />}
        <span className="text-xs font-normal text-slate-500">
          Có thể để trống khi nghiệp vụ chưa xác định Area Type.
        </span>
      </label>
      <label className={labelClassName}>
        <span>Mô tả</span>
        <textarea
          rows={3}
          {...register('description', {
            setValueAs: (value: string) => value.trim() || null,
          })}
          className={inputClassName}
        />
      </label>
      <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <input type="checkbox" {...register('is_active')} className="h-4 w-4 rounded border-slate-300" /> Đang hoạt động
      </label>

    </CrudDrawerForm>
  );
};
