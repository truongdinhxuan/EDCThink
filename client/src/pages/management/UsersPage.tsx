import { useCallback,useEffect,useState,type MouseEvent } from 'react';
import { listAreas } from '../../api/areas.service';
import { listRoles } from '../../api/roles.service';
import {
createUser,deactivateUser,getUserRoles,getUsers,replaceUserRoles,updateUser,
} from '../../api/users.service';
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
import { UserForm,type UserFormValues,type UserReferenceData } from '../../components/forms/UserForm';
import { UserWorkShiftPanel } from '../../components/users/UserWorkShiftPanel';
import { PERMISSION_CODE } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { useCrudOffcanvas } from '../../hooks/useCrudOffcanvas';
import { useCrudResource } from '../../hooks/useCrudResource';
import { useDebounce } from '../../hooks/useDebounce';
import { usePaginatedResource } from '../../hooks/usePaginatedResource';
import { useServerLookup } from '../../hooks/useServerLookup';
import { queryKeys } from '../../lib/queryKeys';
import type { PaginationParams } from '../../types/pagination.types';
import type { CreateUserInput,UpdateUserInput,UserListParams,UserProfile } from '../../types/users';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

type UserQuery = UserListParams & PaginationParams;

const loadRoles = async (signal: AbortSignal) =>
  (await listRoles(
    { page: 1, pageSize: 100, isActive: true, sortBy: 'code', sortOrder: 'asc' },
    signal,
  )).data;
const loadAreas = async (signal: AbortSignal) =>
  (await listAreas(
    { page: 1, pageSize: 100, isActive: true, sortBy: 'code', sortOrder: 'asc' },
    signal,
  )).data;

const getRoleName = (user: UserProfile): string => {
  if (user.roles?.length) return user.roles.map((role) => role.name).join(', ');
  if (typeof user.role === 'string') return user.role;
  return user.role ? `${user.role.name} (${user.role.code})` : '—';
};

const UsersPage = () => {
  useDocumentTitle('Users');
  const { openConfirm } = useCrudOffcanvas();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission(PERMISSION_CODE.ADMIN_USER_CREATE)
    && hasPermission(PERMISSION_CODE.ADMIN_USER_ASSIGN_ROLE);
  const canUpdate = hasPermission(PERMISSION_CODE.ADMIN_USER_UPDATE);
  const canAssignRoles = hasPermission(PERMISSION_CODE.ADMIN_USER_ASSIGN_ROLE);
  const loader = useCallback((query: UserQuery, signal: AbortSignal) => getUsers(query, signal), []);
  const resource = usePaginatedResource<UserProfile, UserQuery>({
    loader,
    initialQuery: { page: 1, pageSize: 20, sortBy: 'created_at', sortOrder: 'desc' },
    loadErrorMessage: 'Không thể tải danh sách người dùng.',
    queryKey: queryKeys.users.lists,
  });
  const roles = useCrudResource(
    loadRoles,
    'Không thể tải danh sách role.',
    queryKeys.roles.lookup({ pageSize: 100 }),
  );
  const areas = useCrudResource(
    loadAreas,
    'Không thể tải danh sách area.',
    queryKeys.areas.lookup({ pageSize: 100, isActive: true }),
  );
  const managerLoader = useCallback(
    (search: string | undefined, signal: AbortSignal) =>
      getUsers(
        { page: 1, pageSize: 20, search, isActive: true, sortBy: 'first_name', sortOrder: 'asc' },
        signal,
      ),
    [],
  );
  const managers = useServerLookup({
    loader: managerLoader,
    queryKey: (search) => queryKeys.users.lookup({ search, pageSize: 20, isActive: true }),
    errorMessage: 'Không thể tải danh sách người quản lý.',
  });
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 400);
  const resourceSearch = resource.query.search;
  const updateResourceQuery = resource.updateQuery;
  const [editing, setEditing] = useState<UserProfile | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const openView = useCallback((item: UserProfile) => {
    setEditing(item); setViewing(true); setFormError(null); setFormOpen(true);
  }, []);
  const [editingRoleIds, setEditingRoleIds] = useState<string[]>([]);

  const openUserForm = async (target: UserProfile | null) => {
    if (!target) {
      setViewing(false);
      setEditing(null);
      setEditingRoleIds([]);
      setFormError(null); setFormOpen(true);
      return;
    }
    try {
        const assigned = await getUserRoles(target.id);
        setEditingRoleIds(assigned.map((assignedRole) => assignedRole.id));
        setEditing(target);
        setViewing(false);
        setFormError(null); setFormOpen(true);
      } catch {
        resource.setFeedback({ type: 'error', message: 'Không thể tải role của người dùng.' });
      }
    };

    const references: UserReferenceData = {
      roles: roles.items,
      areas: areas.items,
      users: managers.items,
      managerSearch: managers.search,
      setManagerSearch: managers.setSearch,
      loading: roles.loading || areas.loading || managers.loading,
      errors: [roles.error, areas.error, managers.error].filter((error): error is string => Boolean(error)),
    };

    useEffect(() => {
      const search = debouncedSearch.trim() || undefined;
      if (search !== resourceSearch) updateResourceQuery({ search });
    }, [debouncedSearch, resourceSearch, updateResourceQuery]);

    const save = async (values: UserFormValues) => {
      setFormError(null);
      try {
      const commonInput = {
        email: values.email,
        first_name: values.first_name,
        last_name: values.last_name,
        vinfast_id: values.vinfast_id,
        phone_number: values.phone_number.trim() || null,
        avatar_url: values.avatar_url.trim() || null,
        area_id: values.area_id,
        managed_by_user_id: values.managed_by_user_id || null,
      };
      const action = editing
        ? async () => {
            const profile = await updateUser(editing.id, { ...commonInput, is_active: values.is_active, is_verified: values.is_verified } satisfies UpdateUserInput);
            if (canAssignRoles) await replaceUserRoles(editing.id, values.role_ids);
            return profile;
          }
        : () => createUser({ ...commonInput, password: values.password, role_ids: values.role_ids } satisfies CreateUserInput);
      const ok = await resource.runMutation(
        action,
        editing ? 'Đã cập nhật người dùng.' : 'Đã tạo tài khoản nội bộ. Tài khoản đang chờ duyệt.',
        editing ? 'Không thể cập nhật người dùng.' : 'Không thể tạo người dùng.',
        { throwOnError: true },
      );
      if (ok) setFormOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Không thể lưu dữ liệu. Vui lòng thử lại.');
    }
  };

  const confirmDeactivate = (user: UserProfile, event: MouseEvent<HTMLButtonElement>) => openConfirm({
    title: 'Ngừng sử dụng tài khoản?',
    description: `Tài khoản “${user.email}” sẽ không còn được phép truy cập dữ liệu nội bộ.`,
    confirmLabel: 'Ngừng sử dụng',
    cancelLabel: 'Quay lại',
    variant: 'warning',
    triggerElement: event.currentTarget,
    onConfirm: () => resource.runMutation(
      () => deactivateUser(user.id),
      'Đã ngừng sử dụng người dùng.',
      'Không thể ngừng sử dụng người dùng.',
      { removeCurrentItem: resource.query.isActive === true, throwOnError: true },
    ),
  });

  const columns: Column<UserProfile>[] = [
    { header: 'Email', accessor: 'email', sortKey: 'email' },
    { header: 'VinFast ID', accessor: 'vinfast_id', sortKey: 'vinfast_id' },
    { header: 'Họ và tên', accessor: 'first_name', sortKey: 'first_name', render: (user) => `${user.first_name} ${user.last_name}`.trim() },
    { header: 'Role', accessor: 'role_id', render: getRoleName },
    { header: 'Area', accessor: 'area_id', render: (user) => user.area ? `${user.area.code} - ${user.area.name}` : '—' },
    { header: 'Active', accessor: 'is_active', sortKey: 'is_active', render: (user) => <StatusBadge active={user.is_active} /> },
    { header: 'Duyệt', accessor: 'is_verified', render: (user) => <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${user.is_verified ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>{user.is_verified ? 'Đã duyệt' : 'Chờ duyệt'}</span> },
    { header: 'Thao tác', accessor: 'actions', render: (user: UserProfile) => <RowActions onView={() => openView(user)} onEdit={canUpdate ? () => void openUserForm(user) : undefined} onDelete={canUpdate && user.is_active ? (event) => confirmDeactivate(user, event) : undefined} deleteLabel="Ngừng sử dụng" /> },
  ];

  const resetFilters = () => {
    setSearchInput('');
    resource.updateQuery({ roleId: undefined, areaId: undefined, isActive: undefined });
  };

  return (
    <PageFilterLayout rail={(
      <PageFilterRail
        title="Bộ lọc người dùng"
        onReset={resetFilters}
        resetDisabled={searchInput.length === 0 && !resource.query.roleId && !resource.query.areaId && resource.query.isActive === undefined}
      >
        <FilterSection>
          <FilterField label="Tìm kiếm"><input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Tìm email, VinFast ID hoặc tên..." className={inputClassName} /></FilterField>
          <FilterField label="Role"><select disabled={roles.loading && roles.items.length === 0} value={resource.query.roleId ?? ''} onChange={(event) => resource.updateQuery({ roleId: event.target.value || undefined })} className={inputClassName}><option value="">{roles.loading && roles.items.length === 0 ? 'Đang tải role...' : 'Tất cả role'}</option>{roles.items.map((role) => <option key={role.id} value={role.id}>{role.name} ({role.code})</option>)}</select></FilterField>
          <FilterField label="Area"><select disabled={areas.loading && areas.items.length === 0} value={resource.query.areaId ?? ''} onChange={(event) => resource.updateQuery({ areaId: event.target.value || undefined })} className={inputClassName}><option value="">{areas.loading && areas.items.length === 0 ? 'Đang tải area...' : 'Tất cả area'}</option>{areas.items.map((area) => <option key={area.id} value={area.id}>{area.code}</option>)}</select></FilterField>
          <FilterField label="Trạng thái"><select value={resource.query.isActive === undefined ? '' : String(resource.query.isActive)} onChange={(event) => resource.updateQuery({ isActive: event.target.value === '' ? undefined : event.target.value === 'true' })} className={inputClassName}><option value="">Tất cả trạng thái</option><option value="true">Active</option><option value="false">Inactive</option></select></FilterField>
        </FilterSection>
        {(roles.error || areas.error) && <p role="alert" className="text-xs text-amber-700">Một số bộ lọc tham chiếu chưa tải được.</p>}
      </PageFilterRail>
    )}><div className="min-w-0 space-y-6">
      <CrudPageHeader title="Users" description="Quản lý hồ sơ, nhiều role, khu vực và trạng thái duyệt tài khoản." createLabel="Thêm người dùng" onCreate={canCreate ? () => void openUserForm(null) : undefined} />
      <CrudFeedbackToast feedback={resource.feedback} onClose={() => resource.setFeedback(null)} />
      {resource.error ? (
        <ErrorState message={resource.error} onRetry={() => void resource.reload()} />
      ) : (
        <DataTable
          columns={columns}
          data={resource.items}
          loading={resource.loading}
          keyExtractor={(user) => user.id}
          hideInternalSearch
          pagination={resource.pagination}
          onPageChange={resource.setPage}
          onPageSizeChange={resource.setPageSize}
          sortBy={resource.query.sortBy}
          sortOrder={resource.query.sortOrder}
          onSortChange={(sortBy, sortOrder) => resource.updateQuery({ sortBy, sortOrder })}
          emptyText="Không có người dùng phù hợp."
        />
      )}
      {formOpen && (viewing || (editing ? canUpdate : canCreate)) && (
        <PrimaryCrudDrawer mode={viewing ? 'view' : editing ? 'edit' : 'create'} size="lg" onEdit={viewing && canUpdate ? () => void openUserForm(editing) : undefined} error={formError} title={viewing ? 'Chi tiết người dùng' : (editing ? 'Chỉnh sửa người dùng' : 'Tạo người dùng')} busy={resource.mutating} onClose={() => setFormOpen(false)}>
          {viewing && editing ? <CrudEntityView fields={[
            { label: 'Họ và tên', value: `${editing.first_name} ${editing.last_name}` },
            { label: 'Email', value: editing.email },
            { label: 'VinFast ID', value: editing.vinfast_id },
            { label: 'Điện thoại', value: editing.phone_number },
            { label: 'Roles', value: getRoleName(editing), fullWidth: true },
            { label: 'Khu vực', value: editing.area ? `${editing.area.code} — ${editing.area.name}` : '—' },
            { label: 'Đã duyệt', value: editing.is_verified ? 'Đã duyệt' : 'Chờ duyệt' },
            { label: 'Trạng thái', value: <StatusBadge active={editing.is_active && !editing.is_deleted} /> },
            { label: 'Ngày tạo', value: new Date(editing.created_at).toLocaleString('vi-VN') },
            { label: 'Cập nhật', value: new Date(editing.updated_at).toLocaleString('vi-VN') },
          ]} /> : (<UserForm key={`${editing?.id ?? 'create'}-${editingRoleIds.join('-')}`} user={editing} roleIds={editingRoleIds} canAssignRoles={canAssignRoles} references={references} busy={resource.mutating} onSave={save} />)}
          {editing && <UserWorkShiftPanel userId={editing.id} canAssign={!viewing && canUpdate} />}
        </PrimaryCrudDrawer>
      )}
    </div></PageFilterLayout>
  );
};

export default UsersPage;
