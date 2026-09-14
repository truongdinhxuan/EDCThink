import { useCallback,useEffect,useState,type MouseEvent } from 'react';
import {
createProvider,
deactivateProvider,
getProviders,
updateProvider,
} from '../../api/providers.service';
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
import { ProviderForm } from '../../components/forms/ProviderForm';
import { PERMISSION_CODE } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { useCrudOffcanvas } from '../../hooks/useCrudOffcanvas';
import { useDebounce } from '../../hooks/useDebounce';
import { usePaginatedResource } from '../../hooks/usePaginatedResource';
import { queryKeys } from '../../lib/queryKeys';
import type { PaginationParams } from '../../types/pagination.types';
import type {
CreateProviderInput,
Provider,
ProviderListParams,
} from '../../types/providers';

const UNKNOWN_PROVIDER_CODE = 'UNKNOW';

type ProviderQuery = ProviderListParams & PaginationParams;
type StatusFilter = 'active' | 'inactive' | 'deleted';

const initialQuery: ProviderQuery = {
  page: 1,
  pageSize: 20,
  isActive: true,
  isDeleted: false,
  sortBy: 'code',
  sortOrder: 'asc',
};

const resolveStatusFilter = (query: ProviderQuery): StatusFilter => {
  if (query.isDeleted) return 'deleted';
  return query.isActive === false ? 'inactive' : 'active';
};

const statusQuery = (
  status: StatusFilter,
): Pick<ProviderQuery, 'isActive' | 'isDeleted'> => {
  if (status === 'deleted') return { isActive: false, isDeleted: true };
  if (status === 'inactive') return { isActive: false, isDeleted: false };
  return { isActive: true, isDeleted: false };
};

const formatDate = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('vi-VN', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date);
};

const ProvidersPage = () => {
  const { openConfirm } = useCrudOffcanvas();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission(PERMISSION_CODE.SUPPLY_CATALOG_CREATE);
  const canUpdate = hasPermission(PERMISSION_CODE.SUPPLY_CATALOG_UPDATE);
  const canDelete = hasPermission(PERMISSION_CODE.SUPPLY_CATALOG_DELETE);
  const hasActions = true; // Read access is already enforced by the page guard.
  const loader = useCallback(
    (query: ProviderQuery, signal: AbortSignal) => getProviders(query, signal),
    [],
  );
  const resource = usePaginatedResource<Provider, ProviderQuery>({
    loader,
    initialQuery,
    loadErrorMessage: 'Không thể tải danh sách Provider.',
    queryKey: queryKeys.providers.lists,
    invalidateQueryKeys: [
      queryKeys.providers.lookups,
      queryKeys.supplyProviders.all,
      queryKeys.supplies.all,
    ],
  });
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 400);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const openView = useCallback((item: Provider) => {
    setEditing(item); setViewing(true); setFormError(null); setFormOpen(true);
  }, []);
  const resourceSearch = resource.query.search;
  const updateResourceQuery = resource.updateQuery;

  useEffect(() => {
    const nextSearch = debouncedSearch.trim() || undefined;
    if (nextSearch !== resourceSearch) {
      updateResourceQuery({ search: nextSearch });
    }
  }, [debouncedSearch, resourceSearch, updateResourceQuery]);

  const save = async (values: CreateProviderInput) => {
    setFormError(null);
    try {
      const input = {
        ...values,
        code: values.code.trim(),
        name: values.name.trim(),
        description: values.description?.trim() || null,
      };
      const ok = await resource.runMutation(
        () => editing
          ? updateProvider(editing.id, input)
          : createProvider(input),
        editing ? 'Đã cập nhật Provider.' : 'Đã tạo Provider.',
        editing ? 'Không thể cập nhật Provider.' : 'Không thể tạo Provider.',
        { throwOnError: true },
      );
      if (ok) {
        setFormOpen(false);
        setEditing(null);
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Không thể lưu dữ liệu. Vui lòng thử lại.');
    }
  };

  const confirmDeactivate = (
    item: Provider,
    event: MouseEvent<HTMLButtonElement>,
  ) => openConfirm({
    title: 'Ngừng sử dụng Provider?',
    description: `Provider “${item.code} — ${item.name}” sẽ ngừng hoạt động và bị soft delete.`,
    confirmLabel: 'Ngừng sử dụng',
    cancelLabel: 'Quay lại',
    variant: 'warning',
    triggerElement: event.currentTarget,
    onConfirm: () => resource.runMutation(
      () => deactivateProvider(item.id),
      'Đã ngừng sử dụng Provider.',
      'Không thể ngừng sử dụng Provider.',
      {
        removeCurrentItem: resolveStatusFilter(resource.query) === 'active',
        throwOnError: true,
      },
    ),
  });

  const columns: Column<Provider>[] = [
    {
      header: 'Code',
      accessor: 'code',
      sortKey: 'code',
      render: (item) => item.code === UNKNOWN_PROVIDER_CODE
        ? <span className="font-bold text-amber-700">UNKNOW — Chưa rõ</span>
        : <span className="font-semibold text-slate-800">{item.code}</span>,
    },
    { header: 'Tên', accessor: 'name', sortKey: 'name' },
    {
      header: 'Mô tả',
      accessor: 'description',
      render: (item) => item.description || '—',
    },
    {
      header: 'Trạng thái',
      accessor: 'is_active',
      sortKey: 'is_active',
      render: (item) => <StatusBadge active={item.is_active && !item.is_deleted} />,
    },
    {
      header: 'Cập nhật',
      accessor: 'updated_at',
      sortKey: 'updated_at',
      render: (item) => formatDate(item.updated_at),
    },
    ...(hasActions ? [{
      header: 'Thao tác',
      accessor: 'actions',
      render: (item: Provider) => (
        <RowActions
          onView={() => openView(item)}
          onEdit={canUpdate ? () => {
            setEditing(item);
            setViewing(false); setFormError(null); setFormOpen(true);
          } : undefined}
          onDelete={!canDelete || item.code === UNKNOWN_PROVIDER_CODE
            ? undefined
            : (event) => confirmDeactivate(item, event)}
          deleteLabel="Ngừng sử dụng"
        />
      ),
    }] : []),
  ];

  const resetFilters = () => {
    setSearch('');
    resource.updateQuery(statusQuery('active'));
  };

  return (
    <PageFilterLayout rail={(
      <PageFilterRail title="Bộ lọc Provider" onReset={resetFilters} resetDisabled={search.length === 0 && resolveStatusFilter(resource.query) === 'active'}>
        <FilterSection>
          <FilterField label="Tìm kiếm"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm code, tên hoặc mô tả Provider..." className={inputClassName} /></FilterField>
          <FilterField label="Trạng thái"><select value={resolveStatusFilter(resource.query)} onChange={(event) => resource.updateQuery(statusQuery(event.target.value as StatusFilter))} className={inputClassName}><option value="active">Đang hoạt động</option><option value="inactive">Ngừng hoạt động</option><option value="deleted">Đã deactivate</option></select></FilterField>
        </FilterSection>
      </PageFilterRail>
    )}><div className="min-w-0 space-y-6">
      <CrudPageHeader
        title="Providers"
        description="Quản lý nhà cung cấp được liên kết với vật tư và tồn kho."
        createLabel="Thêm Provider"
        onCreate={canCreate ? () => {
          setEditing(null);
          setViewing(false); setFormError(null); setFormOpen(true);
        } : undefined}
      />
      <CrudFeedbackToast
        feedback={resource.feedback}
        onClose={() => resource.setFeedback(null)}
      />
      {resource.error ? (
        <ErrorState message={resource.error} onRetry={() => void resource.reload()} />
      ) : (
        <DataTable
          columns={columns}
          data={resource.items}
          loading={resource.loading}
          loadingText="Đang tải danh sách Provider..."
          keyExtractor={(item) => item.id}
          hideInternalSearch
          pagination={resource.pagination}
          onPageChange={resource.setPage}
          onPageSizeChange={resource.setPageSize}
          sortBy={resource.query.sortBy}
          sortOrder={resource.query.sortOrder}
          onSortChange={(sortBy, sortOrder) =>
            resource.updateQuery({ sortBy, sortOrder })}
          emptyText="Không có Provider phù hợp."
        />
      )}

      {formOpen && (viewing || (editing ? canUpdate : canCreate)) && (
        <PrimaryCrudDrawer mode={viewing ? 'view' : editing ? 'edit' : 'create'} size="md" onEdit={viewing && canUpdate ? () => setViewing(false) : undefined} error={formError}
          title={viewing ? 'Chi tiết nhà cung cấp' : (editing ? 'Chỉnh sửa Provider' : 'Tạo Provider')}
          busy={resource.mutating}
          onClose={() => setFormOpen(false)}
        >
          {viewing && editing ? <CrudEntityView fields={[
            { label: 'Mã', value: editing.code },
            { label: 'Tên', value: editing.name },
            { label: 'Mô tả', value: editing.description, fullWidth: true },
            { label: 'Trạng thái', value: <StatusBadge active={editing.is_active && !editing.is_deleted} /> },
            { label: 'Ngày tạo', value: new Date(editing.created_at).toLocaleString('vi-VN') },
            { label: 'Cập nhật', value: new Date(editing.updated_at).toLocaleString('vi-VN') },
          ]} /> : (<ProviderForm
            key={editing?.id ?? 'create'}
            item={editing}
            busy={resource.mutating}

            onSave={save}
          />)}
        </PrimaryCrudDrawer>
      )}
    </div></PageFilterLayout>
  );
};

export default ProvidersPage;
