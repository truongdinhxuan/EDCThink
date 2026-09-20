import { useForm } from 'react-hook-form';
import { CrudDrawerForm } from '../crud/CrudDrawerForm';
import { FieldError, inputClassName, labelClassName } from '../crud/CrudPrimitives';
import type { CreateStorageLocationInput, StorageLocation } from '../../types/storage-locations';
import type { Area } from '../../types/areas';
import { SelectSkeleton } from '../common/skeleton';

export const StorageLocationForm = ({ item, areas, areasLoading, areasError, busy, onSave }: {
  item: StorageLocation | null;
  areas: Area[];
  areasLoading: boolean;
  areasError: string | null;
  busy: boolean;
  onSave: (values: CreateStorageLocationInput) => Promise<void>;
}) => {
  const { register, handleSubmit, formState: { errors, isDirty } } = useForm<CreateStorageLocationInput>({
    defaultValues: {
      code: item?.code ?? '',
      area_id: item?.area_id ?? '',
      name: item?.name ?? '',
      description: item?.description ?? '',
      is_active: item?.is_active ?? true,
    },
  });
  const referencesUnavailable = areasLoading || Boolean(areasError) || areas.length === 0;
  return <CrudDrawerForm isDirty={isDirty} busy={busy} submitDisabled={referencesUnavailable} onSubmit={handleSubmit(onSave)} className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2">
      <label className={labelClassName}><span>Khu vực</span>
        {areasLoading && areas.length === 0 ? <SelectSkeleton label="Đang tải khu vực" /> : <select {...register('area_id', { required: 'Vui lòng chọn khu vực.' })} disabled={Boolean(areasError)} className={inputClassName}>
          <option value="">Chọn khu vực</option>
          {areas.map((area) => <option key={area.id} value={area.id}>{area.code} - {area.name}</option>)}
        </select>}
        {areasError ? <FieldError message={`Không tải được khu vực: ${areasError}`} /> : areas.length === 0 && !areasLoading ? <FieldError message="Chưa có khu vực active để lựa chọn." /> : <FieldError message={errors.area_id?.message} />}
      </label>
      <label className={labelClassName}><span>Mã vị trí kho</span><input {...register('code', { required: 'Vui lòng nhập mã vị trí.', setValueAs: (value: string) => value.trim() })} className={inputClassName} /><FieldError message={errors.code?.message} /></label>
    </div>
    <label className={labelClassName}><span>Tên vị trí</span><input {...register('name', { setValueAs: (value: string) => value.trim() || null })} className={inputClassName} /></label>
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
    <p className="text-xs text-slate-500">Mã vị trí phải duy nhất trong khu vực đã chọn.</p>
    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" {...register('is_active')} className="h-4 w-4 rounded border-slate-300" /> Đang hoạt động</label>

  </CrudDrawerForm>;
};
