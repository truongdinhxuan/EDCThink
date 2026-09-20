import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createUnit, deactivateUnit, listUnits, updateUnit } from '../../api/units.service';
import { UnitForm } from '../../components/catalog/UnitForm';
import { DataTable, type Column } from '../../components/common/DataTable';
import { CrudEntityView } from '../../components/crud/CrudEntityView';
import {
  FilterField,
  FilterSection,
  PageFilterLayout,
  PageFilterRail,
} from '../../components/filters';
import {
  CrudFeedbackToast,
  CrudPageHeader,
  ErrorState,
  inputClassName,
  RowActions,
  StatusBadge,
} from '../../components/crud/CrudPrimitives';
import { DrawerFormFooter } from '../../components/offcanvas';
import { PERMISSION_CODE } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { useCrudOffcanvas } from '../../hooks/useCrudOffcanvas';
import { useDebounce } from '../../hooks/useDebounce';
import { usePaginatedResource } from '../../hooks/usePaginatedResource';
import { queryKeys } from '../../lib/queryKeys';
import type { CrudOffcanvasMode } from '../../types/offcanvas.types';
import type { PaginationParams } from '../../types/pagination.types';
import type { CreateUnitInput, Unit, UnitListParams } from '../../types/units';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

type UnitQuery = UnitListParams & PaginationParams;
type UnitDrawerMode = Extract<CrudOffcanvasMode, 'create' | 'view' | 'edit'>;

interface UnitDrawerState {
  mode: UnitDrawerMode;
  item: Unit | null;
  formId: string;
  formKey: string;
}

const initialQuery: UnitQuery = {
  page: 1,
  pageSize: 20,
  isActive: true,
  sortBy: 'code',
  sortOrder: 'asc',
};

const dateTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short',
  timeStyle: 'short',
});

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date);
};

const getDrawerTitle = (mode: UnitDrawerMode): string => {
  if (mode === 'create') return 'Tạo đơn vị';
  if (mode === 'edit') return 'Chỉnh sửa đơn vị';
  return 'Chi tiết đơn vị';
};

const UnitsPage = () => {
  useDocumentTitle('Đơn vị tính');
  const { hasPermission } = useAuth();
  const canCreate = hasPermission(PERMISSION_CODE.SUPPLY_CATALOG_CREATE);
  const canUpdate = hasPermission(PERMISSION_CODE.SUPPLY_CATALOG_UPDATE);
  const canDelete = hasPermission(PERMISSION_CODE.SUPPLY_CATALOG_DELETE);
  const {
    openCrud,
    openConfirm,
    updatePrimary,
    requestClosePrimary,
    closePrimary,
  } = useCrudOffcanvas();
  const loader = useCallback((query: UnitQuery, signal: AbortSignal) => listUnits(query, signal), []);
  const resource = usePaginatedResource<Unit, UnitQuery>({
    loader,
    initialQuery,
    loadErrorMessage: 'Không thể tải danh sách đơn vị.',
    queryKey: queryKeys.units.lists,
    mutationInvalidateQueryKey: queryKeys.units.lists,
  });
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 400);
  const resourceSearch = resource.query.search;
  const updateResourceQuery = resource.updateQuery;
  const [drawer, setDrawer] = useState<UnitDrawerState | null>(null);
  const [drawerDirty, setDrawerDirty] = useState(false);
  const [drawerBusy, setDrawerBusy] = useState(false);
  const drawerSequence = useRef(0);
  const runMutation = resource.runMutation;
  const setFeedback = resource.setFeedback;
  const activeFilter = resource.query.isActive;

  const resetFilters = useCallback(() => {
    setSearch('');
    updateResourceQuery({ isActive: true });
  }, [updateResourceQuery]);

  useEffect(() => {
    const nextSearch = debouncedSearch.trim() || undefined;
    if (resourceSearch !== nextSearch) updateResourceQuery({ search: nextSearch });
  }, [debouncedSearch, resourceSearch, updateResourceQuery]);

  const resetDrawerState = useCallback(() => {
    setDrawer(null);
    setDrawerDirty(false);
    setDrawerBusy(false);
  }, []);

  const saveUnit = useCallback(async (
    mode: UnitDrawerMode,
    item: Unit | null,
    values: CreateUnitInput,
  ): Promise<boolean> => {
    if (mode === 'view') return false;
    const editing = mode === 'edit' && item;
    const ok = await runMutation(
      () => editing ? updateUnit(editing.id, values) : createUnit(values),
      editing ? 'Cập nhật đơn vị thành công.' : 'Tạo đơn vị thành công.',
      editing ? 'Không thể cập nhật đơn vị.' : 'Không thể tạo đơn vị.',
    );
    if (ok) {
      setDrawerDirty(false);
      closePrimary();
    }
    return ok;
  }, [closePrimary, runMutation]);

  const switchViewToEdit = useCallback(() => {
    setFeedback(null);
    setDrawerDirty(false);
    setDrawerBusy(false);
    setDrawer((current) => current?.item ? {
      ...current,
      mode: 'edit',
      formKey: `${current.item.id}-edit-${Date.now()}`,
    } : current);
  }, [setFeedback]);

  const renderDrawerContent = useCallback((
    current: UnitDrawerState,
    serverError: string | null,
  ): ReactNode => {
    if (current.mode === 'view' && current.item) {
      return (
        <CrudEntityView
          fields={[
            { label: 'Mã đơn vị', value: current.item.code },
            { label: 'Ký hiệu', value: current.item.symbol },
            { label: 'Tên đơn vị', value: current.item.name },
            { label: 'Trạng thái', value: <StatusBadge active={current.item.is_active} /> },
            { label: 'Mô tả', value: current.item.description || '—', fullWidth: true },
            { label: 'Ngày tạo', value: formatDateTime(current.item.created_at) },
            { label: 'Cập nhật', value: formatDateTime(current.item.updated_at) },
          ]}
        />
      );
    }

    return (
      <UnitForm
        key={current.formKey}
        formId={current.formId}
        item={current.item}
        serverError={serverError}
        onDirtyChange={setDrawerDirty}
        onSubmittingChange={setDrawerBusy}
        onSave={(values) => saveUnit(current.mode, current.item, values)}
      />
    );
  }, [saveUnit]);

  const renderDrawerFooter = useCallback((
    current: UnitDrawerState,
    busy: boolean,
  ): ReactNode => {
    const viewing = current.mode === 'view';
    return (
      <DrawerFormFooter
        cancelLabel={viewing ? 'Đóng' : 'Hủy'}
        submitLabel={viewing ? 'Chỉnh sửa' : current.mode === 'create' ? 'Tạo' : 'Lưu thay đổi'}
        submittingLabel="Đang lưu..."
        isSubmitting={busy}
        formId={viewing ? undefined : current.formId}
        showSubmit={!viewing || canUpdate}
        onCancel={() => requestClosePrimary('cancel')}
        onSubmit={viewing && canUpdate ? switchViewToEdit : undefined}
      />
    );
  }, [canUpdate, requestClosePrimary, switchViewToEdit]);

  useEffect(() => {
    if (!drawer) return;
    const serverError = resource.feedback?.type === 'error'
      ? resource.feedback.message
      : null;
    updatePrimary({
      mode: drawer.mode,
      title: getDrawerTitle(drawer.mode),
      description: drawer.mode === 'view'
        ? 'Thông tin đơn vị tính hiện tại.'
        : 'Nhập đầy đủ các trường bắt buộc.',
      content: renderDrawerContent(drawer, serverError),
      footer: renderDrawerFooter(drawer, drawerBusy),
      isDirty: drawer.mode === 'view' ? false : drawerDirty,
      isBusy: drawerBusy,
      preventCloseWhileBusy: true,
    });
  }, [
    drawer,
    drawerBusy,
    drawerDirty,
    renderDrawerContent,
    renderDrawerFooter,
    resource.feedback,
    updatePrimary,
  ]);

  const openUnitDrawer = useCallback((
    mode: UnitDrawerMode,
    item: Unit | null,
    triggerElement: HTMLElement | null,
  ) => {
    drawerSequence.current += 1;
    const next: UnitDrawerState = {
      mode,
      item,
      formId: `unit-form-${drawerSequence.current}`,
      formKey: `${item?.id ?? 'create'}-${mode}-${drawerSequence.current}`,
    };
    setFeedback(null);
    setDrawerDirty(false);
    setDrawerBusy(false);
    setDrawer(next);
    openCrud({
      mode,
      title: getDrawerTitle(mode),
      description: mode === 'view'
        ? 'Thông tin đơn vị tính hiện tại.'
        : 'Nhập đầy đủ các trường bắt buộc.',
      content: renderDrawerContent(next, null),
      footer: renderDrawerFooter(next, false),
      isDirty: false,
      isBusy: false,
      preventCloseWhileBusy: true,
      triggerElement,
      onClosed: resetDrawerState,
    });
  }, [
    openCrud,
    renderDrawerContent,
    renderDrawerFooter,
    resetDrawerState,
    setFeedback,
  ]);

  const openDeactivate = useCallback((
    item: Unit,
    trigger: HTMLElement | null,
  ) => {
    openConfirm({
      title: 'Ngừng sử dụng đơn vị?',
      description: `Đơn vị “${item.symbol}” sẽ được chuyển sang inactive nếu chưa bị ràng buộc.`,
      confirmLabel: 'Ngừng sử dụng',
      cancelLabel: 'Hủy',
      variant: 'warning',
      triggerElement: trigger,
      preventCloseWhileBusy: true,
      onConfirm: async () => {
        const ok = await runMutation(
          () => deactivateUnit(item.id),
          'Ngừng sử dụng đơn vị thành công.',
          'Không thể ngừng sử dụng đơn vị.',
          { removeCurrentItem: activeFilter === true, throwOnError: true },
        );
        return ok ? undefined : false;
      },
    });
  }, [activeFilter, openConfirm, runMutation]);

  const columns: Column<Unit>[] = [
    { header: 'Mã', accessor: 'code', sortKey: 'code' },
    { header: 'Ký hiệu', accessor: 'symbol', sortKey: 'symbol' },
    { header: 'Tên', accessor: 'name', sortKey: 'name' },
    {
      header: 'Trạng thái',
      accessor: 'is_active',
      sortKey: 'is_active',
      render: (item) => <StatusBadge active={item.is_active} />,
    },
    {
      header: 'Thao tác',
      accessor: 'actions',
      render: (item) => (
        <RowActions
          ariaLabel={`Thao tác cho ${item.code}`}
          onView={(trigger) => openUnitDrawer('view', item, trigger)}
          onEdit={canUpdate
            ? (trigger) => openUnitDrawer('edit', item, trigger)
            : undefined}
          onDelete={canDelete
            ? (trigger) => openDeactivate(item, trigger)
            : undefined}
        />
      ),
    },
  ];

  return (
    <PageFilterLayout
      rail={(
        <PageFilterRail
          onReset={resetFilters}
          resetDisabled={search.length === 0 && activeFilter === true}
        >
          <FilterSection>
            <FilterField label="Tìm kiếm">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tìm mã hoặc ký hiệu..."
                className={inputClassName}
              />
            </FilterField>
            <FilterField label="Trạng thái">
              <select
                value={String(activeFilter ?? true)}
                onChange={(event) => updateResourceQuery({
                  isActive: event.target.value === 'true',
                })}
                className={inputClassName}
              >
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </FilterField>
          </FilterSection>
        </PageFilterRail>
      )}
    >
      <div className="min-w-0 space-y-6">
        <CrudPageHeader
          title="Quản lý đơn vị tính"
          onCreate={canCreate
            ? (event) => openUnitDrawer('create', null, event.currentTarget)
            : undefined}
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
            keyExtractor={(item) => item.id}
            hideInternalSearch
            pagination={resource.pagination}
            onPageChange={resource.setPage}
            onPageSizeChange={resource.setPageSize}
            sortBy={resource.query.sortBy}
            sortOrder={resource.query.sortOrder}
            onSortChange={(sortBy, sortOrder) => updateResourceQuery({ sortBy, sortOrder })}
            emptyText="Không có đơn vị phù hợp."
          />
        )}
      </div>
    </PageFilterLayout>
  );
};

export default UnitsPage;
