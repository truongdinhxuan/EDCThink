import { useCallback,useEffect,useState,type MouseEvent } from 'react';
import {
createSupplyCategory,
deactivateSupplyCategory,
listSupplyCategories,
updateSupplyCategory,
} from '../../api/supply-categories.service';
import { DataTable,type Column } from '../../components/common/DataTable';
import { CrudEntityView } from '../../components/crud/CrudEntityView';
import {
CrudFeedbackToast,
CrudPageHeader,
ErrorState,
inputClassName,
RowActions,
StatusBadge
} from '../../components/crud/CrudPrimitives';
import { PrimaryCrudDrawer } from '../../components/crud/PrimaryCrudDrawer';
import { FilterField,FilterSection,PageFilterLayout,PageFilterRail } from '../../components/filters';
import { SupplyCategoryForm } from '../../components/forms/SupplyCategoryForm';
import { PERMISSION_CODE } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { useCrudOffcanvas } from '../../hooks/useCrudOffcanvas';
import { useDebounce } from '../../hooks/useDebounce';
import { usePaginatedResource } from '../../hooks/usePaginatedResource';
import { queryKeys } from '../../lib/queryKeys';
import type { PaginationParams } from '../../types/pagination.types';
import type {
CreateSupplyCategoryInput,
SupplyCategory,
SupplyCategoryListParams,
} from '../../types/supply-categories';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

type CategoryQuery = SupplyCategoryListParams & PaginationParams;
const initialQuery: CategoryQuery = {
  page: 1,
  pageSize: 20,
  isActive: true,
  sortBy: 'code',
  sortOrder: 'asc',
};

const SupplyCategoriesPage = () => {
  useDocumentTitle('Loại vật tư');
  const { openConfirm } = useCrudOffcanvas();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission(PERMISSION_CODE.SUPPLY_CATALOG_CREATE);
  const canUpdate = hasPermission(PERMISSION_CODE.SUPPLY_CATALOG_UPDATE);
  const canDelete = hasPermission(PERMISSION_CODE.SUPPLY_CATALOG_DELETE);
  const hasActions = true; // Read access is already enforced by the page guard.
  const loader = useCallback((query: CategoryQuery, signal: AbortSignal) => listSupplyCategories(query, signal), []);
  const resource = usePaginatedResource<SupplyCategory, CategoryQuery>({
    loader,
    initialQuery,
    loadErrorMessage: 'Không thể tải danh mục vật tư.',
    queryKey: queryKeys.supplyCategories.lists,
    invalidateQueryKeys: [queryKeys.supplies.all],
  });
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 400);
  const resourceSearch = resource.query.search;
  const updateResourceQuery = resource.updateQuery;
  const [editing, setEditing] = useState<SupplyCategory | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const openView = useCallback((item: SupplyCategory) => {
    setEditing(item); setViewing(true); setFormError(null); setFormOpen(true);
  }, []);

  useEffect(() => {
    const nextSearch = debouncedSearch.trim() || undefined;
    if (resourceSearch !== nextSearch) updateResourceQuery({ search: nextSearch });
  }, [debouncedSearch, resourceSearch, updateResourceQuery]);

  const save = async (values: CreateSupplyCategoryInput) => {
    setFormError(null);
    try {
      const ok = await resource.runMutation(
        () => editing ? updateSupplyCategory(editing.id, values) : createSupplyCategory(values),
        editing ? 'Đã cập nhật danh mục.' : 'Đã tạo danh mục.',
        editing ? 'Không thể cập nhật danh mục.' : 'Không thể tạo danh mục.',
        { throwOnError: true },
      );
      if (ok) setFormOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Không thể lưu dữ liệu. Vui lòng thử lại.');
    }
  };

  const confirmDeactivate = (
    item: SupplyCategory,
    event: MouseEvent<HTMLButtonElement>,
  ) => openConfirm({
    title: 'Ngừng sử dụng danh mục?',
    description: `Danh mục “${item.code}” sẽ được soft delete nếu không vi phạm ràng buộc dữ liệu.`,
    confirmLabel: 'Ngừng sử dụng',
    cancelLabel: 'Quay lại',
    variant: 'warning',
    triggerElement: event.currentTarget,
    onConfirm: () => resource.runMutation(
      () => deactivateSupplyCategory(item.id),
      'Đã ngừng sử dụng danh mục.',
      'Không thể ngừng sử dụng danh mục.',
      {
        removeCurrentItem: resource.query.isActive === true,
        throwOnError: true,
      },
    ),
  });

  const columns: Column<SupplyCategory>[] = [
    { header: 'Mã', accessor: 'code', sortKey: 'code' },
    { header: 'Tên', accessor: 'name', sortKey: 'name' },
    { header: 'Mô tả', accessor: 'description', sortKey: 'description', render: (item) => item.description || '—' },
    { header: 'Trạng thái', accessor: 'is_active', sortKey: 'is_active', render: (item) => <StatusBadge active={item.is_active} /> },
    ...(hasActions ? [{
      header: 'Thao tác',
      accessor: 'actions',
      render: (item: SupplyCategory) => <RowActions onView={() => openView(item)} onEdit={canUpdate ? () => { setEditing(item); setViewing(false); setFormError(null); setFormOpen(true); } : undefined} onDelete={canDelete ? (event) => confirmDeactivate(item, event) : undefined} deleteLabel="Ngừng sử dụng" />,
    }] : []),
  ];

  const resetFilters = () => {
    setSearch('');
    resource.updateQuery({ isActive: true });
  };

  return (
    <PageFilterLayout rail={(
      <PageFilterRail title="Bộ lọc danh mục" onReset={resetFilters} resetDisabled={search.length === 0 && resource.query.isActive === true}>
        <FilterSection>
          <FilterField label="Tìm kiếm"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm mã hoặc mô tả danh mục..." className={inputClassName} /></FilterField>
          <FilterField label="Trạng thái"><select value={String(resource.query.isActive ?? true)} onChange={(event) => resource.updateQuery({ isActive: event.target.value === 'true' })} className={inputClassName}><option value="true">Active</option><option value="false">Inactive</option></select></FilterField>
        </FilterSection>
      </PageFilterRail>
    )}><div className="min-w-0 space-y-6">
      <CrudPageHeader
        title="Supply categories"
        description="Quản lý nhóm vật tư với mã danh mục duy nhất."
        createLabel="Thêm danh mục"
        onCreate={canCreate ? () => { setEditing(null); setViewing(false); setFormError(null); setFormOpen(true); } : undefined}
      />
      <CrudFeedbackToast feedback={resource.feedback} onClose={() => resource.setFeedback(null)} />
      {resource.error ? <ErrorState message={resource.error} onRetry={() => void resource.reload()} /> : (
        <DataTable
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
          emptyText="Không có danh mục phù hợp."
        />
      )}
      {formOpen && (viewing || (editing ? canUpdate : canCreate)) && <PrimaryCrudDrawer mode={viewing ? 'view' : editing ? 'edit' : 'create'} size="md" onEdit={viewing && canUpdate ? () => setViewing(false) : undefined} error={formError} title={viewing ? 'Chi tiết danh mục vật tư' : (editing ? 'Chỉnh sửa danh mục' : 'Tạo danh mục')} busy={resource.mutating} onClose={() => setFormOpen(false)}>{viewing && editing ? <CrudEntityView fields={[
            { label: 'Mã', value: editing.code },
            { label: 'Tên', value: editing.name },
            { label: 'Mô tả', value: editing.description, fullWidth: true },
            { label: 'Trạng thái', value: <StatusBadge active={editing.is_active && !editing.is_deleted} /> },
            { label: 'Ngày tạo', value: new Date(editing.created_at).toLocaleString('vi-VN') },
            { label: 'Cập nhật', value: new Date(editing.updated_at).toLocaleString('vi-VN') },
          ]} /> : (<SupplyCategoryForm key={editing?.id ?? 'create'} item={editing} busy={resource.mutating} onSave={save} />)}</PrimaryCrudDrawer>}
    </div></PageFilterLayout>
  );
};

export default SupplyCategoriesPage;
