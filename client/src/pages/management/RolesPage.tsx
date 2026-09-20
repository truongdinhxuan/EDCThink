import { useQuery } from '@tanstack/react-query';
import { useCallback,useEffect,useState } from 'react';
import { listAreaTypes } from '../../api/area-types.service';
import { listPermissions } from '../../api/permissions.service';
import {
createRole,deleteRole,getRoleAreaTypeScopes,getRolePermissions,listRoles,
replaceRoleAreaTypeScopes,replaceRolePermissions,updateRole,
} from '../../api/roles.service';
import { DataTable,type Column } from '../../components/common/DataTable';
import { CrudEntityView } from '../../components/crud/CrudEntityView';
import {
CrudFeedbackToast,CrudPageHeader,ErrorState,
inputClassName,RowActions,StatusBadge
} from '../../components/crud/CrudPrimitives';
import { CrudDrawerForm } from '../../components/crud/CrudDrawerForm';
import { PrimaryCrudDrawer } from '../../components/crud/PrimaryCrudDrawer';
import { FilterField,FilterSection,PageFilterLayout,PageFilterRail } from '../../components/filters';
import { RoleForm,type RoleFormValues } from '../../components/forms/RoleForm';
import { PERMISSION_CODE } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { useCrudOffcanvas } from '../../hooks/useCrudOffcanvas';
import { useDebounce } from '../../hooks/useDebounce';
import { usePaginatedResource } from '../../hooks/usePaginatedResource';
import { queryKeys } from '../../lib/queryKeys';
import type { PaginationParams } from '../../types/pagination.types';
import type { AreaTypeSummary } from '../../types/area-scopes';
import type { Permission } from '../../types/permissions';
import type { CreateRoleInput,Role,RoleListParams,UpdateRoleInput } from '../../types/roles';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

const sameIds = (left: string[], right: string[]): boolean =>
  left.length === right.length && [...left].sort().join() === [...right].sort().join();

type RoleQuery = RoleListParams & PaginationParams;
const initialQuery: RoleQuery = { page: 1, pageSize: 20, sortBy: 'code', sortOrder: 'asc' };

const RolesPage = () => {
  useDocumentTitle('Vai trò');
  const { openConfirm } = useCrudOffcanvas();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission(PERMISSION_CODE.ADMIN_ROLE_CREATE);
  const canUpdate = hasPermission(PERMISSION_CODE.ADMIN_ROLE_UPDATE);
  const canAssign = hasPermission(PERMISSION_CODE.ADMIN_ROLE_ASSIGN_PERMISSION);
  const loader = useCallback((query: RoleQuery, signal: AbortSignal) => listRoles(query, signal), []);
  const resource = usePaginatedResource<Role, RoleQuery>({
    loader, initialQuery, loadErrorMessage: 'Không thể tải danh sách vai trò.',
    queryKey: queryKeys.roles.lists,
    invalidateQueryKeys: [
      queryKeys.users.all,
      queryKeys.rolePermissions.all,
      queryKeys.userRoles.all,
      queryKeys.roleAreaTypeScopes.all,
      queryKeys.meAreaScopes.all,
    ],
  });
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 400);
  const [editing, setEditing] = useState<Role | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const openView = useCallback((item: Role) => {
    setEditing(item); setViewing(true); setFormError(null); setFormOpen(true);
  }, []);
  const [permissionTarget, setPermissionTarget] = useState<Role | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<string[]>([]);
  // The drawer guards unsaved work, which needs something to compare against.
  const [loadedPermissionIds, setLoadedPermissionIds] = useState<string[]>([]);
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [areaScopeTarget, setAreaScopeTarget] = useState<Role | null>(null);
  const [areaTypeSelection, setAreaTypeSelection] = useState<{
    roleId: string;
    ids: string[];
  } | null>(null);
  const [areaScopeError, setAreaScopeError] = useState<string | null>(null);
  const isSystemAdminTarget = areaScopeTarget?.code === 'ADMIN' && areaScopeTarget.is_system;
  const areaTypesQuery = useQuery<AreaTypeSummary[]>({
    queryKey: queryKeys.areaTypes.all,
    queryFn: ({ signal }) => listAreaTypes(signal),
    enabled: Boolean(areaScopeTarget),
    staleTime: 10 * 60 * 1000,
  });
  const roleAreaTypeScopesQuery = useQuery<AreaTypeSummary[]>({
    queryKey: queryKeys.roleAreaTypeScopes.detail(areaScopeTarget?.id ?? ''),
    queryFn: () => getRoleAreaTypeScopes(areaScopeTarget!.id),
    enabled: Boolean(areaScopeTarget) && !isSystemAdminTarget,
    staleTime: 60 * 1000,
  });
  const areaTypes = areaTypesQuery.data ?? [];
  const selectedAreaTypeIds = areaTypeSelection && areaTypeSelection.roleId === areaScopeTarget?.id
    ? areaTypeSelection.ids
    : roleAreaTypeScopesQuery.data?.map((areaType) => areaType.id) ?? [];
  const areaScopeLoading = areaTypesQuery.isPending
    || (!isSystemAdminTarget && roleAreaTypeScopesQuery.isPending);
  const areaScopeLoadError = areaTypesQuery.isError || roleAreaTypeScopesQuery.isError;
  const resourceSearch = resource.query.search;
  const updateResourceQuery = resource.updateQuery;

  useEffect(() => {
    const next = debouncedSearch.trim() || undefined;
    if (resourceSearch !== next) updateResourceQuery({ search: next });
  }, [debouncedSearch, resourceSearch, updateResourceQuery]);

  const save = async (values: RoleFormValues) => {
    setFormError(null);
    try {
      const input: CreateRoleInput = {
        code: values.code, name: values.name,
        description: values.description || null, is_active: values.is_active,
      };
      const ok = await resource.runMutation(
        editing ? () => updateRole(editing.id, input satisfies UpdateRoleInput) : () => createRole(input),
        editing ? 'Đã cập nhật vai trò.' : 'Đã tạo vai trò.',
        editing ? 'Không thể cập nhật vai trò.' : 'Không thể tạo vai trò.',
        { throwOnError: true },
      );
      if (ok) setFormOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Không thể lưu dữ liệu. Vui lòng thử lại.');
    }
  };

  const confirmDelete = (role: Role, trigger: HTMLElement | null) => openConfirm({
    title: 'Xóa vai trò?',
    description: `Vai trò “${role.name}” chỉ được xóa khi chưa được sử dụng.`,
    confirmLabel: 'Xóa vai trò',
    cancelLabel: 'Quay lại',
    variant: 'danger',
    triggerElement: trigger,
    onConfirm: () => resource.runMutation(
      () => deleteRole(role.id),
      'Đã xóa vai trò.',
      'Không thể xóa vai trò.',
      { removeCurrentItem: true, throwOnError: true },
    ),
  });

  const openPermissionMatrix = async (target: Role) => {
    setPermissionTarget(target);
    setPermissionLoading(true);
    setPermissionError(null);
    try {
      const [catalog, assigned] = await Promise.all([
        listPermissions({ page: 1, pageSize: 100, sortBy: 'module', sortOrder: 'asc' }),
        getRolePermissions(target.id),
      ]);
      setPermissions(catalog.data);
      const assignedIds = assigned.map((permission) => permission.id);
      setSelectedPermissionIds(assignedIds);
      setLoadedPermissionIds(assignedIds);
    } catch {
      setPermissionError('Không thể tải loại phân quyền này.');
    } finally {
      setPermissionLoading(false);
    }
  };

  const openAreaTypeScopes = (target: Role) => {
    setAreaScopeTarget(target);
    setAreaTypeSelection(null);
    setAreaScopeError(null);
  };

  const columns: Column<Role>[] = [
    { header: 'Code', accessor: 'code', sortKey: 'code' },
    { header: 'Tên', accessor: 'name', sortKey: 'name' },
    { header: 'Mô tả', accessor: 'description', render: (item) => item.description || '—' },
    { header: 'Loại', accessor: 'is_system', render: (item) => item.is_system ? 'Hệ thống' : 'Tùy chỉnh' },
    { header: 'Trạng thái', accessor: 'is_active', sortKey: 'is_active', render: (item) => <StatusBadge active={item.is_active && !item.is_deleted} /> },
    ...[{
      header: 'Thao tác', accessor: 'actions', render: (item: Role) => (
        <RowActions
          ariaLabel={`Thao tác cho ${item.code}`}
          onView={() => openView(item)} onEdit={canUpdate ? () => { setEditing(item); setViewing(false); setFormError(null); setFormOpen(true); } : undefined}
          onDelete={!canUpdate || item.is_system ? undefined : (trigger) => confirmDelete(item, trigger)}
          deleteLabel="Xóa"
          extraItems={[
            ...(canAssign
              ? [{ label: 'Set quyền', onSelect: () => void openPermissionMatrix(item) }]
              : []),
            { label: 'Set khu vực', onSelect: () => openAreaTypeScopes(item) },
          ]}
        />
      ),
    }],
  ];

  const resetFilters = () => {
    setSearch('');
  };

  return (
    <PageFilterLayout rail={(
      <PageFilterRail onReset={resetFilters} resetDisabled={search.length === 0}>
        <FilterSection>
          <FilterField label="Tìm kiếm"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm code, tên hoặc mô tả..." className={inputClassName} /></FilterField>
        </FilterSection>
      </PageFilterRail>
    )}><div className="min-w-0 space-y-6">
      <CrudPageHeader title="Quản lý vai trò" onCreate={canCreate ? () => { setEditing(null); setViewing(false); setFormError(null); setFormOpen(true); } : undefined} />
      <CrudFeedbackToast feedback={resource.feedback} onClose={() => resource.setFeedback(null)} />
      {resource.error ? <ErrorState message={resource.error} onRetry={() => void resource.reload()} /> : (
        <DataTable columns={columns} data={resource.items} loading={resource.loading} keyExtractor={(item) => item.id}
          hideInternalSearch
          pagination={resource.pagination} onPageChange={resource.setPage} onPageSizeChange={resource.setPageSize}
          sortBy={resource.query.sortBy} sortOrder={resource.query.sortOrder}
          onSortChange={(sortBy, sortOrder) => resource.updateQuery({ sortBy, sortOrder })}
          emptyText="Không có vai trò phù hợp." />
      )}
      {formOpen && (viewing || (editing ? canUpdate : canCreate)) && (
        <PrimaryCrudDrawer mode={viewing ? 'view' : editing ? 'edit' : 'create'} size="md" onEdit={viewing && canUpdate ? () => setViewing(false) : undefined} error={formError} title={viewing ? 'Chi tiết vai trò' : (editing ? 'Chỉnh sửa vai trò' : 'Tạo vai trò')} busy={resource.mutating} onClose={() => setFormOpen(false)}>
          {viewing && editing ? <CrudEntityView fields={[
            { label: 'Mã', value: editing.code },
            { label: 'Tên', value: editing.name },
            { label: 'Mô tả', value: editing.description, fullWidth: true },
            { label: 'Loại', value: editing.is_system ? 'Hệ thống' : 'Tùy chỉnh' },
            { label: 'Trạng thái', value: <StatusBadge active={editing.is_active && !editing.is_deleted} /> },
            { label: 'Ngày tạo', value: new Date(editing.created_at).toLocaleString('vi-VN') },
            { label: 'Cập nhật', value: new Date(editing.updated_at).toLocaleString('vi-VN') },
          ]} /> : (<RoleForm key={editing?.id ?? 'create'} role={editing} busy={resource.mutating} onSave={save} />)}
        </PrimaryCrudDrawer>
      )}
      {permissionTarget && canAssign && (
        <PrimaryCrudDrawer
          mode="edit"
          size="lg"
          title={`Menu quyền cho vai trò ${permissionTarget.name}`}
          busy={resource.mutating || permissionLoading}
          onClose={() => setPermissionTarget(null)}
        >
          {permissionError ? <ErrorState message={permissionError} onRetry={() => void openPermissionMatrix(permissionTarget)} /> : permissionLoading ? (
            <p className="py-8 text-center text-sm text-slate-500">Đang tải...</p>
          ) : (
            <CrudDrawerForm
              isDirty={!sameIds(selectedPermissionIds, loadedPermissionIds)}
              busy={resource.mutating}
              className="space-y-5"
              onSubmit={async () => {
                const ok = await resource.runMutation(
                  () => replaceRolePermissions(permissionTarget.id, selectedPermissionIds),
                  'Đã cập nhật phân quyền của vai trò.',
                  'Không thể cập nhật phân quyền của vai trò.',
                );
                if (ok) setPermissionTarget(null);
              }}
            >
              {[...new Set(permissions.map((permission) => permission.module))].map((module) => (
                <fieldset key={module} className="rounded-xl border border-slate-200 p-4">
                  <legend className="px-2 text-sm font-bold text-slate-800">{module}</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {permissions.filter((permission) => permission.module === module).map((permission) => (
                      <label key={permission.id} className="flex items-start gap-3 rounded-lg p-2 hover:bg-slate-50">
                        <input type="checkbox" checked={selectedPermissionIds.includes(permission.id)}
                          onChange={(event) => setSelectedPermissionIds((current) => event.target.checked ? [...current, permission.id] : current.filter((id) => id !== permission.id))}
                          className="mt-1 h-4 w-4 rounded border-slate-300" />
                        <span className="block text-sm font-semibold text-slate-800">{permission.name}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </CrudDrawerForm>
          )}
        </PrimaryCrudDrawer>
      )}
      {areaScopeTarget && (
        <PrimaryCrudDrawer
          // Read-only for the system ADMIN bypass and for anyone without update
          // rights: the footer then offers Đóng instead of a save nobody can do.
          mode={canUpdate && !isSystemAdminTarget ? 'edit' : 'view'}
          size="md"
          title={`Chọn khu vực cho ${areaScopeTarget.name}`}
          busy={resource.mutating || areaScopeLoading}
          error={areaScopeError}
          onClose={() => setAreaScopeTarget(null)}
        >
          {areaScopeLoadError ? (
            <ErrorState
              message="Không thể tải loại khu vực."
              onRetry={() => {
                setAreaScopeError(null);
                void areaTypesQuery.refetch();
                if (!isSystemAdminTarget) void roleAreaTypeScopesQuery.refetch();
              }}
            />
          ) : areaScopeLoading ? (
            <p className="py-8 text-center text-sm text-slate-500">Đang tải loại khu vực...</p>
          ) : isSystemAdminTarget ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
                <p className="font-bold">Toàn bộ loại khu vực (System Admin)</p>
                <p className="mt-1">Quyền này là bypass; không tạo mapping PACKING, LOGISTICS hoặc SHOP.</p>
              </div>
              <div className="space-y-2">
                {areaTypes.map((areaType) => (
                  <div key={areaType.id} className="rounded-lg border border-slate-200 px-3 py-2">
                    <span className="text-sm font-semibold text-slate-800">{areaType.name}</span>
                    <span className="ml-2 text-xs text-slate-500">{areaType.code}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : !canUpdate ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">Bạn chỉ có quyền xem cấu hình này.</p>
              <div className="space-y-2">
                {areaTypes
                  .filter((areaType) => selectedAreaTypeIds.includes(areaType.id))
                  .map((areaType) => (
                    <div key={areaType.id} className="rounded-lg border border-slate-200 px-3 py-2">
                      <span className="text-sm font-semibold text-slate-800">{areaType.name}</span>
                      <span className="ml-2 text-xs text-slate-500">{areaType.code}</span>
                    </div>
                  ))}
                {selectedAreaTypeIds.length === 0 && (
                  <p className="text-sm text-slate-500">Vai trò này chưa được cấp loại khu vực nào.</p>
                )}
              </div>
            </div>
          ) : (
            <CrudDrawerForm
              isDirty={!sameIds(
                selectedAreaTypeIds,
                roleAreaTypeScopesQuery.data?.map((areaType) => areaType.id) ?? [],
              )}
              busy={resource.mutating}
              className="space-y-5"
              onSubmit={async () => {
                setAreaScopeError(null);
                try {
                  const ok = await resource.runMutation(
                    () => replaceRoleAreaTypeScopes(areaScopeTarget.id, selectedAreaTypeIds),
                    'Đã cập nhật khu vực của vai trò.',
                    'Không thể cập nhật khu vực của vai trò.',
                    { throwOnError: true },
                  );
                  if (ok) setAreaScopeTarget(null);
                } catch (error: unknown) {
                  setAreaScopeError(error instanceof Error
                    ? error.message
                    : 'Không thể cập nhật khu vực của vai trò.');
                }
              }}
            >
              <fieldset className="rounded-xl border border-slate-200 p-4">
                <legend className="px-2 text-sm font-bold text-slate-800">Quyền truy cập loại khu vực</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {areaTypes.map((areaType) => (
                    <label key={areaType.id} className="flex items-start gap-3 rounded-lg p-2 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={selectedAreaTypeIds.includes(areaType.id)}
                        onChange={(event) => setAreaTypeSelection({
                          roleId: areaScopeTarget.id,
                          ids: event.target.checked
                            ? [...selectedAreaTypeIds, areaType.id]
                            : selectedAreaTypeIds.filter((id) => id !== areaType.id),
                        })}
                        className="mt-1 h-4 w-4 rounded border-slate-300"
                      />
                      <span>
                        <span className="block text-sm font-semibold text-slate-800">{areaType.name}</span>
                        {areaType.description && (
                          <span className="mt-1 block text-xs text-slate-500">{areaType.description}</span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
                {areaTypes.length === 0 && (
                  <p className="text-sm text-slate-500">Không có loại khu vực nào đang hoạt động.</p>
                )}
              </fieldset>
            </CrudDrawerForm>
          )}
        </PrimaryCrudDrawer>
      )}
    </div></PageFilterLayout>
  );
};

export default RolesPage;
