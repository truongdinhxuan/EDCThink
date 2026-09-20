import { useForm } from 'react-hook-form';
import { CrudDrawerForm } from '../crud/CrudDrawerForm';
import { FieldError, inputClassName, labelClassName } from '../crud/CrudPrimitives';
import { Controller } from 'react-hook-form';
import type { CreateSupplyInput, Supply } from '../../types/supplies';
import type { SupplyCategory } from '../../types/supply-categories';
import type { Unit } from '../../types/units';
import type { Provider } from '../../types/providers';
import { SelectSkeleton } from '../common/skeleton';
import { MultiSelect } from '../common/MultiSelect';
const optionalNumber = (value: string) => value === '' ? null : Number(value);

export const SupplyForm = ({ item, busy, categories, categoriesLoading, categoriesError, units, unitsLoading, unitsError, providers, providersLoading, providersError, onSave }: {
  item: Supply | null;
  busy: boolean;
  categories: SupplyCategory[];
  categoriesLoading: boolean;
  categoriesError: string | null;
  units: Unit[];
  unitsLoading: boolean;
  unitsError: string | null;
  providers: Provider[];
  providersLoading: boolean;
  providersError: string | null;
  onSave: (values: CreateSupplyInput) => Promise<void>;
}) => {
  const { control, register, handleSubmit, formState: { errors, isDirty } } = useForm<CreateSupplyInput>({
    defaultValues: {
      code: item?.code ?? '',
      short_text: item?.short_text ?? '',
      translation_text: item?.translation_text ?? '',
      category_id: item?.category_id ?? '',
      unit_id: item?.unit_id ?? '',
      description: item?.description ?? '',
      min_stock: item?.min_stock ?? null,
      max_stock: item?.max_stock ?? null,
      safety_stock: item?.safety_stock ?? null,
      image_url: item?.image_url ?? '',
      is_active: item?.is_active ?? true,
      provider_ids: item?.providers.map((provider) => provider.id) ?? [],
    },
  });
  const referencesUnavailable = categoriesLoading || unitsLoading || providersLoading
    || Boolean(categoriesError || unitsError || providersError)
    || categories.length === 0 || units.length === 0 || providers.length === 0;

  return <CrudDrawerForm isDirty={isDirty} busy={busy} submitDisabled={referencesUnavailable} onSubmit={handleSubmit(onSave)} className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2">
      <label className={labelClassName}><span>Mã vật tư</span><input {...register('code', { required: 'Vui lòng nhập mã vật tư.', setValueAs: (value: string) => value.trim() })} className={inputClassName} /><FieldError message={errors.code?.message} /></label>
      <label className={labelClassName}>
        <span>Tên ngắn</span>
        <input
          {...register('short_text', {
            required: 'Vui lòng nhập tên ngắn vật tư.',
            setValueAs: (value: string) => value.trim(),
          })}
          className={inputClassName}
        />
        <FieldError message={errors.short_text?.message} />
      </label>
      <label className={labelClassName}><span>Danh mục</span>
        {categoriesLoading && categories.length === 0 ? <SelectSkeleton label="Đang tải danh mục vật tư" /> : <select {...register('category_id', { required: 'Vui lòng chọn danh mục.' })} disabled={Boolean(categoriesError)} className={inputClassName}>
          <option value="">Chọn danh mục</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.code} - {category.name}</option>)}
        </select>}
        {categoriesError ? <FieldError message={`Không tải được danh mục: ${categoriesError}`} /> : categories.length === 0 && !categoriesLoading ? <FieldError message="Chưa có danh mục active để lựa chọn." /> : <FieldError message={errors.category_id?.message} />}
      </label>
      <label className={labelClassName}><span>Đơn vị tính</span>
        {unitsLoading && units.length === 0 ? <SelectSkeleton label="Đang tải đơn vị tính" /> : <select {...register('unit_id', { required: 'Vui lòng chọn đơn vị tính.' })} disabled={Boolean(unitsError)} className={inputClassName}>
          <option value="">Chọn đơn vị</option>
          {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} - {unit.name} ({unit.symbol})</option>)}
        </select>}
        {unitsError ? <FieldError message={`Không tải được đơn vị: ${unitsError}`} /> : units.length === 0 && !unitsLoading ? <FieldError message="Chưa có đơn vị active để lựa chọn." /> : <FieldError message={errors.unit_id?.message} />}
      </label>
    </div>
    <label className={labelClassName}>
      <span>Providers</span>
      <Controller
        control={control}
        name="provider_ids"
        rules={{ validate: (value) => value.length > 0 || 'Vui lòng chọn ít nhất một Provider.' }}
        render={({ field }) => (
          <MultiSelect
            options={providers.map((provider) => ({ value: provider.id, label: `${provider.code} — ${provider.name}` }))}
            value={field.value}
            onChange={field.onChange}
            disabled={busy || providersLoading || Boolean(providersError)}
            loading={providersLoading}
            error={providersError}
            placeholder="Chọn một hoặc nhiều Provider"
            ariaLabel="Chọn Provider cung cấp vật tư"
          />
        )}
      />
      {!providersLoading && !providersError && providers.length === 0 ? <FieldError message="Chưa có Provider active để lựa chọn." /> : <FieldError message={errors.provider_ids?.message} />}
    </label>
    <label className={labelClassName}>
      <span>Tên dịch</span>
      <input
        {...register('translation_text', {
          setValueAs: (value: string) => value.trim() || null,
        })}
        className={inputClassName}
      />
    </label>
    <label className={labelClassName}><span>Mô tả vật tư</span><textarea rows={3} {...register('description', { setValueAs: (value: string) => value.trim() || null })} className={inputClassName} /></label>
    <div className="grid gap-4 sm:grid-cols-3">
      <label className={labelClassName}><span>Min stock</span><input type="number" min="0" step="any" {...register('min_stock', { setValueAs: optionalNumber, min: { value: 0, message: 'Không được âm.' } })} className={inputClassName} /><FieldError message={errors.min_stock?.message} /></label>
      <label className={labelClassName}><span>Max stock</span><input type="number" min="0" step="any" {...register('max_stock', { setValueAs: optionalNumber, min: { value: 0, message: 'Không được âm.' } })} className={inputClassName} /><FieldError message={errors.max_stock?.message} /></label>
      <label className={labelClassName}><span>Safety stock</span><input type="number" min="0" step="any" {...register('safety_stock', { setValueAs: optionalNumber, min: { value: 0, message: 'Không được âm.' } })} className={inputClassName} /><FieldError message={errors.safety_stock?.message} /></label>
    </div>
    <label className={labelClassName}><span>Image URL</span><input type="url" {...register('image_url', { setValueAs: (value: string) => value.trim() || null })} className={inputClassName} /></label>
    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" {...register('is_active')} className="h-4 w-4 rounded border-slate-300" /> Đang hoạt động</label>

  </CrudDrawerForm>;
};
