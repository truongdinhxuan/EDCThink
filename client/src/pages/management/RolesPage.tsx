import { useQuery } from '@tanstack/react-query';
import { useCallback,useEffect,useState,type MouseEvent } from 'react';
import { listAreaTypes } from '../../api/area-types.service';
import { listPermissions } from '../../api/permissions.service';
import {
createRole,deleteRole,getRoleAreaTypeScopes,getRolePermissions,listRoles,
replaceRoleAreaTypeScopes,replaceRolePermissions,updateRole,
} from '../../api/roles.service';
import { TextButton } from '../../components/common/Button';
import { DataTable,type Column } from '../../components/common/DataTable';
import { CrudEntityView } from '../../components/crud/CrudEntityView';
import {
CrudFeedbackToast,CrudModal,CrudPageHeader,ErrorState,
FormActions,
inputClassName,RowActions,StatusBadge
} from '../../components/crud/CrudPrimitives';
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

type RoleQuery = RoleListParams & PaginationParams;
const initialQuery: RoleQuery = { page: 1, pageSize: 20, sortBy: 'code', sortOrder: 'asc' };

const RolesPage = () => {
  useDocumentTitle('Roles');
  const { openConfirm } = useCrudOffcanvas();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission(PERMISSION_CODE.ADMIN_ROLE_CREATE);
  const canUpdate = hasPermission(PERMISSION_CODE.ADMIN_ROLE_UPDATE);
  const canAssign = hasPermission(PERMISSION_CODE.ADMIN_ROLE_ASSIGN_PERMISSION);
  const loader = useCallback((query: RoleQuery, signal: AbortSignal) => listRoles(query, signal), []);
  const resource = usePaginatedResource<Role, RoleQuery>({
    loader, initialQuery, loadErrorMessage: 'Không thể tải danh sách role.',
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
        editing ? 'Đã cập nhật role.' : 'Đã tạo role.',
        editing ? 'Không thể cập nhật role.' : 'Không thể tạo role.',
        { throwOnError: true },
      );
      if (ok) setFormOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Không thể lưu dữ liệu. Vui lòng thử lại.');
    }
  };

  const confirmDelete = (role: Role, event: MouseEvent<HTMLButtonElement>) => openConfirm({
    title: 'Xóa role?',
    description: `Role “${role.name}” chỉ được xóa khi chưa được sử dụng.`,
    confirmLabel: 'Xóa role',
    cancelLabel: 'Quay lại',
    variant: 'danger',
    triggerElement: event.currentTarget,
    onConfirm: () => resource.runMutation(
      () => deleteRole(role.id),
      'Đã xóa role.',
      'Không thể xóa role.',
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
      setSelectedPermissionIds(assigned.map((permission) => permission.id));
    } catch {
      setPermissionError('Không thể tải permission matrix.');
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
        <div className="flex justify-end gap-2">
          {canAssign && <button type="button" className={TextButton} onClick={() => void openPermissionMatrix(item)}>Permissions</button>}
          <button type="button" className={TextButton} onClick={() => openAreaTypeScopes(item)}>Area Types</button>
          <RowActions
            onView={() => openView(item)} onEdit={canUpdate ? () => { setEditing(item); setViewing(false); setFormError(null); setFormOpen(true); } : undefined}
            onDelete={!canUpdate || item.is_system ? undefined : (event) => confirmDelete(item, event)}
            deleteLabel="Xóa"
          />
        </div>
      ),
    }],
  ];

  const resetFilters = () => {
    setSearch('');
  };

  return (
    <PageFilterLayout rail={(
      <PageFilterRail title="Bộ lọc role" onReset={resetFilters} resetDisabled={search.length === 0}>
        <FilterSection>
          <FilterField label="Tìm kiếm"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm code, tên hoặc mô tả..." className={inputClassName} /></FilterField>
        </FilterSection>
      </PageFilterRail>
    )}><div className="min-w-0 space-y-6">
      <CrudPageHeader title="Roles" description="Role động và permission matrix theo catalog hệ thống." createLabel="Thêm role" onCreate={canCreate ? () => { setEditing(null); setViewing(false); setFormError(null); setFormOpen(true); } : undefined} />
      <CrudFeedbackToast feedback={resource.feedback} onClose={() => resource.setFeedback(null)} />
      {resource.error ? <ErrorState message={resource.error} onRetry={() => void resource.reload()} /> : (
        <DataTable columns={columns} data={resource.items} loading={resource.loading} keyExtractor={(item) => item.id}
          hideInternalSearch
          pagination={resource.pagination} onPageChange={resource.setPage} onPageSizeChange={resource.setPageSize}
          sortBy={resource.query.sortBy} sortOrder={resource.query.sortOrder}
          onSortChange={(sortBy, sortOrder) => resource.updateQuery({ sortBy, sortOrder })}
          emptyText="Không có role phù hợp." />
      )}
      {formOpen && (viewing || (editing ? canUpdate : canCreate)) && (
        <PrimaryCrudDrawer mode={viewing ? 'view' : editing ? 'edit' : 'create'} size="md" onEdit={viewing && canUpdate ? () => setViewing(false) : undefined} error={formError} title={viewing ? 'Chi tiết role' : (editing ? 'Chỉnh sửa role' : 'Tạo role')} busy={resource.mutating} onClose={() => setFormOpen(false)}>
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
        <CrudModal title={`Permissions — ${permissionTarget.name}`} busy={resource.mutating || permissionLoading} onClose={() => setPermissionTarget(null)}>
          {permissionError ? <ErrorState message={permissionError} onRetry={() => void openPermissionMatrix(permissionTarget)} /> : permissionLoading ? (
            <p className="py-8 text-center text-sm text-slate-500">Đang tải permission matrix...</p>
          ) : (
            <form className="space-y-5" onSubmit={(event) => {
              event.preventDefault();
              void resource.runMutation(() => replaceRolePermissions(permissionTarget.id, selectedPermissionIds), 'Đã cập nhật permission của role.', 'Không thể cập nhật permission của role.').then((ok) => { if (ok) setPermissionTarget(null); });
            }}>
              {[...new Set(permissions.map((permission) => permission.module))].map((module) => (
                <fieldset key={module} className="rounded-xl border border-slate-200 p-4">
                  <legend className="px-2 text-sm font-bold text-slate-800">{module}</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {permissions.filter((permission) => permission.module === module).map((permission) => (
                      <label key={permission.id} className="flex items-start gap-3 rounded-lg p-2 hover:bg-slate-50">
                        <input type="checkbox" checked={selectedPermissionIds.includes(permission.id)}
                          onChange={(event) => setSelectedPermissionIds((current) => event.target.checked ? [...current, permission.id] : current.filter((id) => id !== permission.id))}
                          className="mt-1 h-4 w-4 rounded border-slate-300" />
                        <span><span className="block text-sm font-semibold text-slate-800">{permission.name}</span><span className="block text-xs text-slate-500">{permission.code}</span></span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <FormActions busy={resource.mutating} onCancel={() => setPermissionTarget(null)} submitLabel="Lưu permissions" />
            </form>
          )}
        </CrudModal>
      )}
      {areaScopeTarget && (
        <CrudModal
          title={`Area Type Access — ${areaScopeTarget.name}`}
          busy={resource.mutating || areaScopeLoading}
          onClose={() => setAreaScopeTarget(null)}
        >
          {areaScopeError || areaScopeLoadError ? (
            <ErrorState
              message={areaScopeError ?? 'Không thể tải cấu hình Area Type Scope.'}
              onRetry={() => {
                setAreaScopeError(null);
                void areaTypesQuery.refetch();
                if (!isSystemAdminTarget) void roleAreaTypeScopesQuery.refetch();
              }}
            />
          ) : areaScopeLoading ? (
            <p className="py-8 text-center text-sm text-slate-500">Đang tải Area Type Scope...</p>
          ) : isSystemAdminTarget ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
                <p className="font-bold">Toàn bộ Area Type (System Admin)</p>
                <p className="mt-1">Quyền này là system bypass; không tạo mapping PACKING, LOGISTICS hoặc SHOP.</p>
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
          ) : (
            <form className="space-y-5" onSubmit={(event) => {
              event.preventDefault();
              if (!canUpdate) return;
              setAreaScopeError(null);
              void resource.runMutation(
                () => replaceRoleAreaTypeScopes(areaScopeTarget.id, selectedAreaTypeIds),
                'Đã cập nhật Area Type Scope của role.',
                'Không thể cập nhật Area Type Scope của role.',
                { throwOnError: true },
              ).then((ok) => {
                if (ok) setAreaScopeTarget(null);
              }).catch((error: unknown) => {
                setAreaScopeError(error instanceof Error
                  ? error.message
                  : 'Không thể cập nhật Area Type Scope của role.');
              });
            }}>
              <fieldset className="rounded-xl border border-slate-200 p-4">
                <legend className="px-2 text-sm font-bold text-slate-800">Area Type Access</legend>
                <p className="mb-3 text-xs text-slate-500">
                  Scope hiệu lực của user là hợp của tất cả Role đang hoạt động.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {areaTypes.map((areaType) => (
                    <label key={areaType.id} className="flex items-start gap-3 rounded-lg p-2 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={selectedAreaTypeIds.includes(areaType.id)}
                        disabled={!canUpdate}
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
                        <span className="block text-xs text-slate-500">{areaType.code}</span>
                        {areaType.description && (
                          <span className="mt-1 block text-xs text-slate-500">{areaType.description}</span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
                {areaTypes.length === 0 && (
                  <p className="text-sm text-slate-500">Không có Area Type đang hoạt động.</p>
                )}
              </fieldset>
              {canUpdate ? (
                <FormActions
                  busy={resource.mutating}
                  onCancel={() => setAreaScopeTarget(null)}
                  submitLabel="Lưu Area Type Scope"
                />
              ) : (
                <p className="text-sm text-slate-500">Bạn chỉ có quyền xem cấu hình này.</p>
              )}
            </form>
          )}
        </CrudModal>
      )}
    </div></PageFilterLayout>
  );
};

export default RolesPage;
