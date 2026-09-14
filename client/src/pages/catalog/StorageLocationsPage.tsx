import { useCallback,useEffect,useState,type MouseEvent } from 'react';
import { listAreas } from '../../api/areas.service';
import { createStorageLocation,deactivateStorageLocation,listStorageLocations,updateStorageLocation } from '../../api/storage-locations.service';
import { DataTable,type Column } from '../../components/common/DataTable';
import { CrudEntityView } from '../../components/crud/CrudEntityView';
import { CrudFeedbackToast,CrudPageHeader,ErrorState,inputClassName,RowActions,StatusBadge } from '../../components/crud/CrudPrimitives';
import { PrimaryCrudDrawer } from '../../components/crud/PrimaryCrudDrawer';
import { FilterField,FilterSection,PageFilterLayout,PageFilterRail } from '../../components/filters';
import { StorageLocationForm } from '../../components/forms/StorageLocationForm';
import { PERMISSION_CODE } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { useCrudOffcanvas } from '../../hooks/useCrudOffcanvas';
import { useCrudResource } from '../../hooks/useCrudResource';
import { useDebounce } from '../../hooks/useDebounce';
import { usePaginatedResource } from '../../hooks/usePaginatedResource';
import { queryKeys } from '../../lib/queryKeys';
import type { PaginationParams } from '../../types/pagination.types';
import type { CreateStorageLocationInput,StorageLocation,StorageLocationListParams } from '../../types/storage-locations';

type StorageLocationQuery = StorageLocationListParams & PaginationParams;

const loadAreas = async (signal: AbortSignal) =>
  (await listAreas(
    { page: 1, pageSize: 100, isActive: true, sortBy: 'code', sortOrder: 'asc' },
    signal,
  )).data;

const StorageLocationsPage = () => {
  const { openConfirm } = useCrudOffcanvas();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission(PERMISSION_CODE.SUPPLY_CATALOG_CREATE);
  const canUpdate = hasPermission(PERMISSION_CODE.SUPPLY_CATALOG_UPDATE);
  const canDelete = hasPermission(PERMISSION_CODE.SUPPLY_CATALOG_DELETE);
  const hasActions = true; // Read access is already enforced by the page guard.
  const loader = useCallback((query: StorageLocationQuery, signal: AbortSignal) => listStorageLocations(query, signal), []);
  const resource = usePaginatedResource<StorageLocation, StorageLocationQuery>({
    loader,
    initialQuery: { page: 1, pageSize: 20, isActive: true, sortBy: 'code', sortOrder: 'asc' },
    loadErrorMessage: 'Không thể tải danh sách vị trí kho.',
    queryKey: queryKeys.storageLocations.lists,
    invalidateQueryKeys: [queryKeys.stockBalances.all, queryKeys.stockTransactions.all],
  });
  const areas = useCrudResource(
    loadAreas,
    'Không thể tải danh sách khu vực.',
    queryKeys.areas.lookup({ pageSize: 100, isActive: true }),
  );
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 400);
  const resourceSearch = resource.query.search;
  const updateResourceQuery = resource.updateQuery;
  const [editing, setEditing] = useState<StorageLocation | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const openView = useCallback((item: StorageLocation) => {
    setEditing(item); setViewing(true); setFormError(null); setFormOpen(true);
  }, []);

  useEffect(() => {
    const search = debouncedSearch.trim() || undefined;
    if (search !== resourceSearch) updateResourceQuery({ search });
  }, [debouncedSearch, resourceSearch, updateResourceQuery]);

  const save = async (values: CreateStorageLocationInput) => {
    setFormError(null);
    try {
      const ok = await resource.runMutation(
        () => editing ? updateStorageLocation(editing.id, values) : createStorageLocation(values),
        editing ? 'Đã cập nhật vị trí kho.' : 'Đã tạo vị trí kho.',
        editing ? 'Không thể cập nhật vị trí kho.' : 'Không thể tạo vị trí kho.',
        { throwOnError: true },
      );
      if (ok) setFormOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Không thể lưu dữ liệu. Vui lòng thử lại.');
    }
  };
  const confirmDeactivate = (item: StorageLocation, event: MouseEvent<HTMLButtonElement>) => openConfirm({
    title: 'Ngừng sử dụng vị trí kho?',
    description: `Vị trí “${item.code}” sẽ được chuyển sang inactive nếu không vi phạm ràng buộc dữ liệu.`,
    confirmLabel: 'Ngừng sử dụng',
    cancelLabel: 'Quay lại',
    variant: 'warning',
    triggerElement: event.currentTarget,
    onConfirm: () => resource.runMutation(
      () => deactivateStorageLocation(item.id),
      'Đã ngừng sử dụng vị trí kho.',
      'Không thể ngừng sử dụng vị trí kho.',
      { removeCurrentItem: resource.query.isActive === true, throwOnError: true },
    ),
  });

  const columns: Column<StorageLocation>[] = [
    { header: 'Mã', accessor: 'code', sortKey: 'code' },
    { header: 'Tên vị trí', accessor: 'name', sortKey: 'name', render: (item) => item.name || '—' },
    { header: 'Mô tả', accessor: 'description', sortKey: 'description', render: (item) => item.description || '—' },
    { header: 'Khu vực', accessor: 'area_id', render: (item) => item.area ? `${item.area.code} - ${item.area.name}` : '—' },
    { header: 'Trạng thái', accessor: 'is_active', sortKey: 'is_active', render: (item) => <StatusBadge active={item.is_active} /> },
    ...(hasActions ? [{ header: 'Thao tác', accessor: 'actions', render: (item: StorageLocation) => <RowActions onView={() => openView(item)} onEdit={canUpdate ? () => { setEditing(item); setViewing(false); setFormError(null); setFormOpen(true); } : undefined} onDelete={canDelete ? (event) => confirmDeactivate(item, event) : undefined} deleteLabel="Ngừng sử dụng" /> }] : []),
  ];

  const resetFilters = () => {
    setSearchInput('');
    resource.updateQuery({ areaId: undefined, isActive: true });
  };

  return <PageFilterLayout rail={(
    <PageFilterRail title="Bộ lọc vị trí kho" onReset={resetFilters} resetDisabled={searchInput.length === 0 && !resource.query.areaId && resource.query.isActive === true}>
      <FilterSection>
        <FilterField label="Tìm kiếm"><input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Tìm mã hoặc tên vị trí..." className={inputClassName} /></FilterField>
        <FilterField label="Khu vực"><select disabled={areas.loading && areas.items.length === 0} value={resource.query.areaId ?? ''} onChange={(event) => resource.updateQuery({ areaId: event.target.value || undefined })} className={inputClassName}><option value="">{areas.loading && areas.items.length === 0 ? 'Đang tải khu vực...' : 'Tất cả khu vực'}</option>{areas.items.map((area) => <option key={area.id} value={area.id}>{area.code}</option>)}</select></FilterField>
        <FilterField label="Trạng thái"><select value={resource.query.isActive === undefined ? '' : String(resource.query.isActive)} onChange={(event) => resource.updateQuery({ isActive: event.target.value === '' ? undefined : event.target.value === 'true' })} className={inputClassName}><option value="">Tất cả trạng thái</option><option value="true">Đang hoạt động</option><option value="false">Ngừng hoạt động</option></select></FilterField>
      </FilterSection>
      {areas.error && <p role="alert" className="text-xs text-amber-700">Không thể tải bộ lọc khu vực.</p>}
    </PageFilterRail>
  )}><div className="min-w-0 space-y-6">
    <CrudPageHeader title="Storage locations" description="Quản lý vị trí lưu kho theo khu vực." createLabel="Thêm vị trí kho" onCreate={canCreate ? () => { setEditing(null); setViewing(false); setFormError(null); setFormOpen(true); } : undefined} />
    <CrudFeedbackToast feedback={resource.feedback} onClose={() => resource.setFeedback(null)} />
    {resource.error ? <ErrorState message={resource.error} onRetry={resource.reload} /> : <DataTable
      columns={columns}
      data={resource.items}
      loading={resource.loading}
      keyExtractor={(item) => item.id}
      hideInternalSearch
      pagination={resource.pagination}
      onPageChange={resource.setPage}
      onPageSizeChange={resource.setPageSize}
      sortBy={resource.query.sortBy}
      sortOrder={resource.query.sortOrder}
      onSortChange={(sortBy, sortOrder) => resource.updateQuery({ sortBy, sortOrder })}
      emptyText="Không có vị trí kho phù hợp."
    />}
    {formOpen && (viewing || (editing ? canUpdate : canCreate)) && <PrimaryCrudDrawer mode={viewing ? 'view' : editing ? 'edit' : 'create'} size="md" onEdit={viewing && canUpdate ? () => setViewing(false) : undefined} error={formError} title={viewing ? 'Chi tiết vị trí kho' : (editing ? 'Chỉnh sửa vị trí kho' : 'Tạo vị trí kho')} busy={resource.mutating} onClose={() => setFormOpen(false)}>{viewing && editing ? <CrudEntityView fields={[
            { label: 'Mã', value: editing.code },
            { label: 'Tên', value: editing.name },
            { label: 'Khu vực', value: editing.area ? `${editing.area.code} — ${editing.area.name}` : '—' },
            { label: 'Mô tả', value: editing.description, fullWidth: true },
            { label: 'Trạng thái', value: <StatusBadge active={editing.is_active && !editing.is_deleted} /> },
            { label: 'Ngày tạo', value: new Date(editing.created_at).toLocaleString('vi-VN') },
            { label: 'Cập nhật', value: new Date(editing.updated_at).toLocaleString('vi-VN') },
          ]} /> : (<StorageLocationForm key={editing?.id ?? 'create'} item={editing} areas={areas.items} areasLoading={areas.loading} areasError={areas.error} busy={resource.mutating} onSave={save} />)}</PrimaryCrudDrawer>}
  </div></PageFilterLayout>;
};

export default StorageLocationsPage;
