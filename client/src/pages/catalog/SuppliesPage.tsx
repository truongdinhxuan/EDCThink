import { useCallback,useEffect,useState,type MouseEvent } from 'react';
import { getProviders } from '../../api/providers.service';
import { createSupply,deactivateSupply,listSupplies,updateSupply } from '../../api/supplies.service';
import { listSupplyCategories } from '../../api/supply-categories.service';
import { listUnits } from '../../api/units.service';
import { DataTable,type Column } from '../../components/common/DataTable';
import { CrudEntityView } from '../../components/crud/CrudEntityView';
import { CrudFeedbackToast,CrudPageHeader,ErrorState,inputClassName,RowActions,StatusBadge } from '../../components/crud/CrudPrimitives';
import { PrimaryCrudDrawer } from '../../components/crud/PrimaryCrudDrawer';
import { FilterField,FilterSection,PageFilterLayout,PageFilterRail } from '../../components/filters';
import { SupplyForm } from '../../components/forms/SupplyForm';
import { PERMISSION_CODE } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { useCrudOffcanvas } from '../../hooks/useCrudOffcanvas';
import { useCrudResource } from '../../hooks/useCrudResource';
import { useDebounce } from '../../hooks/useDebounce';
import { usePaginatedResource } from '../../hooks/usePaginatedResource';
import { queryKeys } from '../../lib/queryKeys';
import type { PaginationParams } from '../../types/pagination.types';
import type { CreateSupplyInput,Supply,SupplyListParams } from '../../types/supplies';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

type SupplyQuery = SupplyListParams & PaginationParams;

const loadCategories = async (signal: AbortSignal) =>
  (await listSupplyCategories(
    { page: 1, pageSize: 100, isActive: true, sortBy: 'code', sortOrder: 'asc' },
    signal,
  )).data;
const loadUnits = async (signal: AbortSignal) =>
  (await listUnits(
    { page: 1, pageSize: 100, isActive: true, sortBy: 'code', sortOrder: 'asc' },
    signal,
  )).data;
const loadProviders = async (signal: AbortSignal) =>
  (await getProviders(
    { page: 1, pageSize: 100, isActive: true, isDeleted: false, sortBy: 'code', sortOrder: 'asc' },
    signal,
  )).data;

const SuppliesPage = () => {
  useDocumentTitle('Vật tư');
  const { openConfirm } = useCrudOffcanvas();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission(PERMISSION_CODE.SUPPLY_CATALOG_CREATE);
  const canUpdate = hasPermission(PERMISSION_CODE.SUPPLY_CATALOG_UPDATE);
  const canDelete = hasPermission(PERMISSION_CODE.SUPPLY_CATALOG_DELETE);
  const hasActions = true; // Read access is already enforced by the page guard.
  const loader = useCallback((query: SupplyQuery, signal: AbortSignal) => listSupplies(query, signal), []);
  const resource = usePaginatedResource<Supply, SupplyQuery>({
    loader,
    initialQuery: { page: 1, pageSize: 20, isActive: true, isDeleted: false, sortBy: 'code', sortOrder: 'asc' },
    loadErrorMessage: 'Không thể tải danh sách vật tư.',
    queryKey: queryKeys.supplies.lists,
    invalidateQueryKeys: [
      queryKeys.supplyProviders.all,
      queryKeys.stockBalances.all,
      queryKeys.stockTransactions.all,
    ],
  });
  const categories = useCrudResource(
    loadCategories,
    'Không thể tải danh mục vật tư.',
    queryKeys.supplyCategories.lookup({ pageSize: 100, isActive: true }),
  );
  const units = useCrudResource(
    loadUnits,
    'Không thể tải đơn vị tính.',
    queryKeys.units.lookup({ pageSize: 100, isActive: true }),
  );
  const providers = useCrudResource(
    loadProviders,
    'Không thể tải danh sách Provider.',
    queryKeys.providers.lookup({ pageSize: 100, isActive: true, isDeleted: false }),
    { staleTime: 30 * 60 * 1000 },
  );
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 400);
  const resourceSearch = resource.query.search;
  const updateResourceQuery = resource.updateQuery;
  const [editing, setEditing] = useState<Supply | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const openView = useCallback((item: Supply) => {
    setEditing(item); setViewing(true); setFormError(null); setFormOpen(true);
  }, []);

  useEffect(() => {
    const search = debouncedSearch.trim() || undefined;
    if (search !== resourceSearch) updateResourceQuery({ search });
  }, [debouncedSearch, resourceSearch, updateResourceQuery]);

  const save = async (values: CreateSupplyInput) => {
    setFormError(null);
    try {
      const ok = await resource.runMutation(
        () => editing ? updateSupply(editing.id, values) : createSupply(values),
        editing ? 'Đã cập nhật vật tư.' : 'Đã tạo vật tư.',
        editing ? 'Không thể cập nhật vật tư.' : 'Không thể tạo vật tư.',
        { throwOnError: true },
      );
      if (ok) setFormOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Không thể lưu dữ liệu. Vui lòng thử lại.');
    }
  };

  const confirmDeactivate = (item: Supply, event: MouseEvent<HTMLButtonElement>) => openConfirm({
    title: 'Ngừng sử dụng vật tư?',
    description: `Vật tư “${item.code}” sẽ được soft delete/deactivate theo rule backend.`,
    confirmLabel: 'Ngừng sử dụng',
    cancelLabel: 'Quay lại',
    variant: 'warning',
    triggerElement: event.currentTarget,
    onConfirm: () => resource.runMutation(
      () => deactivateSupply(item.id),
      'Đã ngừng sử dụng vật tư.',
      'Không thể ngừng sử dụng vật tư.',
      {
        removeCurrentItem: resource.query.isActive === true || resource.query.isDeleted === false,
        throwOnError: true,
      },
    ),
  });

  const columns: Column<Supply>[] = [
    { header: 'Mã', accessor: 'code', sortKey: 'code' },
    { header: 'Tên ngắn', accessor: 'short_text', sortKey: 'short_text' },
    { header: 'Mô tả', accessor: 'description', sortKey: 'description', render: (item) => item.description || '—' },
    { header: 'Danh mục', accessor: 'category_id', render: (item) => item.category ? `${item.category.code} - ${item.category.name}` : '—' },
    { header: 'Đơn vị', accessor: 'unit_id', render: (item) => item.unit?.symbol ?? item.unit?.code ?? '—' },
    { header: 'Providers', accessor: 'providers', render: (item) => item.providers.length > 0 ? item.providers.map((provider) => `${provider.code} - ${provider.name}`).join(', ') : '—' },
    { header: 'Trạng thái', accessor: 'is_active', sortKey: 'is_active', render: (item) => <StatusBadge active={item.is_active && !item.is_deleted} /> },
    ...(hasActions ? [{ header: 'Thao tác', accessor: 'actions', render: (item: Supply) => <RowActions onView={() => openView(item)} onEdit={canUpdate ? () => { setEditing(item); setViewing(false); setFormError(null); setFormOpen(true); } : undefined} onDelete={canDelete ? (event) => confirmDeactivate(item, event) : undefined} deleteLabel="Ngừng sử dụng" /> }] : []),
  ];

  const resetFilters = () => {
    setSearchInput('');
    resource.updateQuery({ categoryId: undefined, unitId: undefined, isActive: true });
  };

  return <PageFilterLayout rail={(
    <PageFilterRail
      title="Bộ lọc vật tư"
      onReset={resetFilters}
      resetDisabled={searchInput.length === 0
        && !resource.query.categoryId
        && !resource.query.unitId
        && resource.query.isActive === true}
    >
      <FilterSection>
        <FilterField label="Tìm kiếm">
          <input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Tìm mã hoặc mô tả vật tư..." className={inputClassName} />
        </FilterField>
        <FilterField label="Danh mục">
          <select disabled={categories.loading && categories.items.length === 0} value={resource.query.categoryId ?? ''} onChange={(event) => resource.updateQuery({ categoryId: event.target.value || undefined })} className={inputClassName}>
            <option value="">{categories.loading && categories.items.length === 0 ? 'Đang tải danh mục...' : 'Tất cả danh mục'}</option>
            {categories.items.map((category) => <option key={category.id} value={category.id}>{category.code}</option>)}
          </select>
        </FilterField>
        <FilterField label="Đơn vị">
          <select disabled={units.loading && units.items.length === 0} value={resource.query.unitId ?? ''} onChange={(event) => resource.updateQuery({ unitId: event.target.value || undefined })} className={inputClassName}>
            <option value="">{units.loading && units.items.length === 0 ? 'Đang tải đơn vị...' : 'Tất cả đơn vị'}</option>
            {units.items.map((unit) => <option key={unit.id} value={unit.id}>{unit.code}</option>)}
          </select>
        </FilterField>
        <FilterField label="Trạng thái">
          <select value={resource.query.isActive === undefined ? '' : String(resource.query.isActive)} onChange={(event) => resource.updateQuery({ isActive: event.target.value === '' ? undefined : event.target.value === 'true' })} className={inputClassName}>
            <option value="">Tất cả trạng thái</option><option value="true">Đang hoạt động</option><option value="false">Ngừng hoạt động</option>
          </select>
        </FilterField>
      </FilterSection>
      {(categories.error || units.error) && <p role="alert" className="text-xs text-amber-700">Một số danh mục lọc chưa tải được.</p>}
    </PageFilterRail>
  )}><div className="min-w-0 space-y-6">
    <CrudPageHeader title="Supplies" description="Danh mục vật tư dùng cho tồn kho và order." createLabel="Thêm vật tư" onCreate={canCreate ? () => { setEditing(null); setViewing(false); setFormError(null); setFormOpen(true); } : undefined} />
    <CrudFeedbackToast feedback={resource.feedback} onClose={() => resource.setFeedback(null)} />
    {resource.error ? <ErrorState message={resource.error} onRetry={resource.reload} /> : <DataTable
      columns={columns}
      data={resource.items}
      loading={resource.loading}
      loadingText="Đang tải danh sách vật tư..."
      keyExtractor={(item) => item.id}
      hideInternalSearch
      pagination={resource.pagination}
      onPageChange={resource.setPage}
      onPageSizeChange={resource.setPageSize}
      sortBy={resource.query.sortBy}
      sortOrder={resource.query.sortOrder}
      onSortChange={(sortBy, sortOrder) => resource.updateQuery({ sortBy, sortOrder })}
      emptyText="Không có vật tư phù hợp."
    />}
    {formOpen && (viewing || (editing ? canUpdate : canCreate)) && <PrimaryCrudDrawer mode={viewing ? 'view' : editing ? 'edit' : 'create'} size="lg" onEdit={viewing && canUpdate ? () => setViewing(false) : undefined} error={formError} title={viewing ? 'Chi tiết vật tư' : (editing ? 'Chỉnh sửa vật tư' : 'Tạo vật tư')} busy={resource.mutating} onClose={() => setFormOpen(false)}>{viewing && editing ? <CrudEntityView fields={[
            { label: 'Mã', value: editing.code },
            { label: 'Tên ngắn', value: editing.short_text },
            { label: 'Tên dịch', value: editing.translation_text },
            { label: 'Danh mục', value: editing.category ? `${editing.category.code} — ${editing.category.name}` : '—' },
            { label: 'Đơn vị', value: editing.unit ? `${editing.unit.code} — ${editing.unit.name} (${editing.unit.symbol})` : '—' },
            { label: 'Providers', value: editing.providers.map(provider => `${provider.code} — ${provider.name}`).join(', '), fullWidth: true },
            { label: 'Min stock', value: editing.min_stock },
            { label: 'Max stock', value: editing.max_stock },
            { label: 'Safety stock', value: editing.safety_stock },
            { label: 'Ảnh', value: editing.image_url, fullWidth: true },
            { label: 'Mô tả', value: editing.description, fullWidth: true },
            { label: 'Trạng thái', value: <StatusBadge active={editing.is_active && !editing.is_deleted} /> },
            { label: 'Ngày tạo', value: new Date(editing.created_at).toLocaleString('vi-VN') },
            { label: 'Cập nhật', value: new Date(editing.updated_at).toLocaleString('vi-VN') },
          ]} /> : (<SupplyForm key={editing?.id ?? 'create'} item={editing} busy={resource.mutating} categories={categories.items} categoriesLoading={categories.loading} categoriesError={categories.error} units={units.items} unitsLoading={units.loading} unitsError={units.error} providers={providers.items} providersLoading={providers.loading} providersError={providers.error} onSave={save} />)}</PrimaryCrudDrawer>}
  </div></PageFilterLayout>;
};

export default SuppliesPage;
