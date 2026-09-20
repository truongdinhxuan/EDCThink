import { useQuery } from '@tanstack/react-query';
import { useCallback,useEffect,useState } from 'react';
import { listAreaTypes } from '../../api/area-types.service';
import { createArea,deactivateArea,listAreas,updateArea } from '../../api/areas.service';
import { getApiErrorMessage } from '../../api/errors';
import { DataTable,type Column } from '../../components/common/DataTable';
import { CrudEntityView } from '../../components/crud/CrudEntityView';
import {
CrudFeedbackToast,
CrudPageHeader,
ErrorState,
inputClassName,
RowActions,StatusBadge
} from '../../components/crud/CrudPrimitives';
import { PrimaryCrudDrawer } from '../../components/crud/PrimaryCrudDrawer';
import { FilterField,FilterSection,PageFilterLayout,PageFilterRail } from '../../components/filters';
import { AreaForm } from '../../components/forms/AreaForm';
import { PERMISSION_CODE } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { useCrudOffcanvas } from '../../hooks/useCrudOffcanvas';
import { useDebounce } from '../../hooks/useDebounce';
import { usePaginatedResource } from '../../hooks/usePaginatedResource';
import { queryKeys } from '../../lib/queryKeys';
import type { Area,AreaListParams,CreateAreaInput } from '../../types/areas';
import type { PaginationParams } from '../../types/pagination.types';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

type AreaQuery = AreaListParams & PaginationParams;
const initialQuery: AreaQuery = { page: 1, pageSize: 20, isActive: true, sortBy: 'code', sortOrder: 'asc' };

const AreasPage = () => {
  useDocumentTitle('Khu vực');
  const { openConfirm } = useCrudOffcanvas();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission(PERMISSION_CODE.SUPPLY_AREA_CREATE);
  const canUpdate = hasPermission(PERMISSION_CODE.SUPPLY_AREA_UPDATE);
  const canDelete = hasPermission(PERMISSION_CODE.SUPPLY_AREA_DEACTIVATE);
  const hasActions = true; // Read access is already enforced by the page guard.
  const loader = useCallback((query: AreaQuery, signal: AbortSignal) => listAreas(query, signal), []);
  const resource = usePaginatedResource<Area, AreaQuery>({
    loader,
    initialQuery,
    loadErrorMessage: 'Không thể tải danh sách khu vực.',
    queryKey: queryKeys.areas.lists,
    invalidateQueryKeys: [queryKeys.storageLocations.all, queryKeys.users.all, queryKeys.meAreaScopes.all],
  });
  const areaTypesQuery = useQuery({
    queryKey: queryKeys.areaTypes.all,
    queryFn: ({ signal }) => listAreaTypes(signal),
    staleTime: 10 * 60 * 1000,
  });
  const areaTypes = areaTypesQuery.data ?? [];
  const areaTypesError = areaTypesQuery.isError
    ? getApiErrorMessage(areaTypesQuery.error, 'Không thể tải danh sách Area Type.')
    : null;
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 400);
  const resourceSearch = resource.query.search;
  const updateResourceQuery = resource.updateQuery;
  useEffect(() => {
    if ((resourceSearch ?? '') !== debouncedSearch.trim()) updateResourceQuery({ search: debouncedSearch.trim() || undefined });
  }, [debouncedSearch, resourceSearch, updateResourceQuery]);
  const [editing, setEditing] = useState<Area | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const openView = useCallback((item: Area) => {
    setEditing(item); setViewing(true); setFormError(null); setFormOpen(true);
  }, []);
  const save = async (values: CreateAreaInput) => {
    setFormError(null);
    try {
      const ok = await resource.runMutation(
        () => editing ? updateArea(editing.id, values) : createArea(values),
        editing ? 'Đã cập nhật khu vực.' : 'Đã tạo khu vực.',
        editing ? 'Không thể cập nhật khu vực.' : 'Không thể tạo khu vực.',
        { throwOnError: true },
      );
      if (ok) setFormOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Không thể lưu dữ liệu. Vui lòng thử lại.');
    }
  };
  const confirmDeactivate = (area: Area, trigger: HTMLElement | null) => openConfirm({
    title: 'Ngừng sử dụng khu vực?',
    description: `Khu vực “${area.name}” sẽ được chuyển sang trạng thái inactive, không xóa cứng.`,
    confirmLabel: 'Ngừng sử dụng',
    cancelLabel: 'Quay lại',
    variant: 'warning',
    triggerElement: trigger,
    onConfirm: () => resource.runMutation(
      () => deactivateArea(area.id),
      'Đã ngừng sử dụng khu vực.',
      'Không thể ngừng sử dụng khu vực.',
      { removeCurrentItem: resource.query.isActive === true, throwOnError: true },
    ),
  });
  const columns: Column<Area>[] = [
    { header: 'Mã', accessor: 'code', sortKey: 'code' }, { header: 'Tên khu vực', accessor: 'name', sortKey: 'name' },
    { header: 'Area Type', accessor: 'area_type', render: (area) => area.area_type ? `${area.area_type.code} — ${area.area_type.name}` : 'Chưa phân loại' },
    { header: 'Mô tả', accessor: 'description', sortKey: 'description', render: (area) => area.description || '—' },
    { header: 'Trạng thái', accessor: 'is_active', sortKey: 'is_active', render: (area) => <StatusBadge active={area.is_active} /> },
    ...(hasActions ? [{ header: 'Thao tác', accessor: 'actions', render: (area: Area) => <RowActions ariaLabel={`Thao tác cho ${area.code}`} onView={() => openView(area)} onEdit={canUpdate ? () => { setEditing(area); setViewing(false); setFormError(null); setFormOpen(true); } : undefined} onDelete={canDelete ? (trigger) => confirmDeactivate(area, trigger) : undefined} deleteLabel="Ngừng sử dụng" /> }] : []),
  ];
  const resetFilters = () => {
    setSearch('');
    resource.updateQuery({ isActive: true, areaTypeId: undefined });
  };
  return (
    <PageFilterLayout rail={(
      <PageFilterRail onReset={resetFilters} resetDisabled={search.length === 0 && resource.query.isActive === true && !resource.query.areaTypeId}>
        <FilterSection>
          <FilterField label="Tìm kiếm"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm mã hoặc tên khu vực..." className={inputClassName} /></FilterField>
          <FilterField label="Area Type">
            <select value={resource.query.areaTypeId ?? ''} onChange={(event) => resource.updateQuery({ areaTypeId: event.target.value || undefined })} disabled={areaTypesQuery.isPending || Boolean(areaTypesError)} className={inputClassName}>
              <option value="">Tất cả Area Type</option>
              {areaTypes.map((areaType) => <option key={areaType.id} value={areaType.id}>{areaType.code} — {areaType.name}</option>)}
            </select>
          </FilterField>
          <FilterField label="Trạng thái"><select value={String(resource.query.isActive ?? true)} onChange={(event) => resource.updateQuery({ isActive: event.target.value === 'true' })} className={inputClassName}><option value="true">Active</option><option value="false">Inactive</option></select></FilterField>
        </FilterSection>
      </PageFilterRail>
    )}><div className="min-w-0 space-y-6">
      <CrudPageHeader title="Quản lý khu vực" onCreate={canCreate ? () => { setEditing(null); setViewing(false); setFormError(null); setFormOpen(true); } : undefined} />
      <CrudFeedbackToast feedback={resource.feedback} onClose={() => resource.setFeedback(null)} />
      {resource.error ? <ErrorState message={resource.error} onRetry={() => void resource.reload()} /> : <DataTable columns={columns} data={resource.items} loading={resource.loading} keyExtractor={(item) => item.id} hideInternalSearch pagination={resource.pagination} onPageChange={resource.setPage} onPageSizeChange={resource.setPageSize} sortBy={resource.query.sortBy} sortOrder={resource.query.sortOrder} onSortChange={(sortBy, sortOrder) => resource.updateQuery({ sortBy, sortOrder })} emptyText="Không có khu vực phù hợp." />}
      {formOpen && (viewing || (editing ? canUpdate : canCreate)) && <PrimaryCrudDrawer mode={viewing ? 'view' : editing ? 'edit' : 'create'} size="md" onEdit={viewing && canUpdate ? () => setViewing(false) : undefined} error={formError} title={viewing ? 'Chi tiết khu vực' : (editing ? 'Chỉnh sửa khu vực' : 'Tạo khu vực')} busy={resource.mutating} onClose={() => setFormOpen(false)}>{viewing && editing ? <CrudEntityView fields={[
            { label: 'Mã', value: editing.code },
            { label: 'Tên', value: editing.name },
            { label: 'Area Type', value: editing.area_type ? `${editing.area_type.code} — ${editing.area_type.name}` : 'Chưa phân loại' },
            { label: 'Mô tả', value: editing.description, fullWidth: true },
            { label: 'Trạng thái', value: <StatusBadge active={editing.is_active && !editing.is_deleted} /> },
            { label: 'Ngày tạo', value: new Date(editing.created_at).toLocaleString('vi-VN') },
            { label: 'Cập nhật', value: new Date(editing.updated_at).toLocaleString('vi-VN') },
          ]} /> : (<AreaForm key={editing?.id ?? 'create'} area={editing} areaTypes={areaTypes} areaTypesLoading={areaTypesQuery.isPending} areaTypesError={areaTypesError} busy={resource.mutating} onSave={save} />)}</PrimaryCrudDrawer>}
    </div></PageFilterLayout>
  );
};
export default AreasPage;
