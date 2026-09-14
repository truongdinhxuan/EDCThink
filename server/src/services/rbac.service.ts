import type { FastifyInstance } from 'fastify';
import type {
  PermissionListQuery,
  ReplaceRoleAreaTypeScopesBody,
  ReplaceRolePermissionsBody,
  ReplaceUserRolesBody,
} from '../interfaces/rbac';
import { PERMISSION_SORT_FIELDS } from '../schemas/rbac';
import { parsePagination, resolvePaginatedQueryResult } from '../utils/pagination';
import { databaseError, fail } from './master-data.helpers';

const PERMISSION_SELECT = `
  id, code, name, module, description, is_system, is_active, is_deleted,
  created_at, updated_at
`;
const ROLE_SELECT = `
  id, code, name, description, is_system, is_active, is_deleted,
  created_at, updated_at
`;
const AREA_TYPE_SELECT = 'id, code, name, description';

export class RbacService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get db() { return this.fastify.supabaseAdmin; }

  async listPermissions(query: PermissionListQuery = {}) {
    const pagination = parsePagination(query, {
      allowedSortBy: PERMISSION_SORT_FIELDS,
      defaultSortBy: 'module',
      defaultSortOrder: 'asc',
    });
    let request = this.db
      .from('permissions')
      .select(PERMISSION_SELECT, { count: 'exact' })
      .eq('is_active', true)
      .eq('is_deleted', false);
    if (pagination.search) {
      request = request.or([
        `code.ilike.*${pagination.search}*`,
        `name.ilike.*${pagination.search}*`,
        `description.ilike.*${pagination.search}*`,
      ].join(','));
    }
    if (query.module) request = request.eq('module', query.module.trim());
    request = request
      .order(pagination.sortBy, { ascending: pagination.sortOrder === 'asc' });
    if (pagination.sortBy !== 'code') request = request.order('code', { ascending: true });
    const { data, error, count } = await request.range(pagination.from, pagination.to);
    const result = resolvePaginatedQueryResult({ data, error, count }, pagination);
    if (result) return result;
    if (error) databaseError(error, 'Không thể lấy danh sách permission');
    throw new Error('Unreachable pagination state');
  }

  async getRolePermissions(roleId: string) {
    const { data: role, error: roleError } = await this.db
      .from('roles').select('id').eq('id', roleId).eq('is_deleted', false).maybeSingle();
    if (roleError || !role) fail(404, 'Không tìm thấy role');
    const { data, error } = await this.db
      .from('role_permissions')
      .select(`permission:permissions!role_permissions_permission_id_fkey!inner(${PERMISSION_SELECT})`)
      .eq('role_id', roleId)
      .eq('is_active', true)
      .eq('is_deleted', false)
      .eq('permission.is_active', true)
      .eq('permission.is_deleted', false);
    if (error) databaseError(error, 'Không thể lấy permission của role');
    return (data ?? []).map((row) => {
      const value = row.permission as unknown;
      return Array.isArray(value) ? value[0] : value;
    }).filter(Boolean);
  }

  async replaceRolePermissions(
    roleId: string,
    body: ReplaceRolePermissionsBody,
    actorId: string,
  ) {
    const permissionIds = [...new Set(body.permission_ids)];
    const { error } = await this.db.rpc('replace_role_permissions', {
      p_role_id: roleId,
      p_permission_ids: permissionIds,
      p_actor_id: actorId,
    });
    if (error) databaseError(error, 'Không thể cập nhật permission của role');
    return this.getRolePermissions(roleId);
  }

  async listAreaTypes() {
    const { data, error } = await this.db
      .from('area_types')
      .select(AREA_TYPE_SELECT)
      .eq('is_active', true)
      .eq('is_deleted', false)
      .order('code', { ascending: true })
      .order('id', { ascending: true });
    if (error) databaseError(error, 'Không thể lấy danh sách Area Type');
    return data ?? [];
  }

  private async getActiveRole(roleId: string): Promise<{
    id: string;
    code: string;
    name: string;
    is_system: boolean;
  }> {
    const { data, error } = await this.db
      .from('roles')
      .select('id, code, name, is_system')
      .eq('id', roleId)
      .eq('is_active', true)
      .eq('is_deleted', false)
      .maybeSingle();
    if (error) databaseError(error, 'Không thể kiểm tra role');
    if (!data) fail(404, 'Không tìm thấy role đang hoạt động');
    return data as {
      id: string;
      code: string;
      name: string;
      is_system: boolean;
    };
  }

  async getRoleAreaTypeScopes(roleId: string) {
    await this.getActiveRole(roleId);
    const { data, error } = await this.db
      .from('role_area_type_scopes')
      .select(`area_type:area_types!role_area_type_scopes_area_type_id_fkey!inner(${AREA_TYPE_SELECT})`)
      .eq('role_id', roleId)
      .eq('area_type.is_active', true)
      .eq('area_type.is_deleted', false);
    if (error) databaseError(error, 'Không thể lấy Area Type Scope của role');
    return (data ?? [])
      .map((row) => {
        const value = row.area_type as unknown;
        return Array.isArray(value) ? value[0] : value;
      })
      .filter(Boolean)
      .sort((left, right) => {
        const leftCode = String((left as { code?: string }).code ?? '');
        const rightCode = String((right as { code?: string }).code ?? '');
        return leftCode.localeCompare(rightCode);
      });
  }

  async replaceRoleAreaTypeScopes(
    roleId: string,
    body: ReplaceRoleAreaTypeScopesBody,
    actorId: string,
  ) {
    const role = await this.getActiveRole(roleId);
    if (role.code === 'ADMIN' && role.is_system === true) {
      fail(409, 'System ADMIN luôn được truy cập toàn bộ Area Type');
    }

    const areaTypeIds = [...new Set(body.areaTypeIds)];
    if (areaTypeIds.length > 0) {
      const { data, error } = await this.db
        .from('area_types')
        .select('id')
        .in('id', areaTypeIds)
        .eq('is_active', true)
        .eq('is_deleted', false);
      if (error) databaseError(error, 'Không thể kiểm tra Area Type');
      if ((data ?? []).length !== areaTypeIds.length) {
        fail(400, 'Một hoặc nhiều Area Type không tồn tại hoặc không hoạt động');
      }
    }

    const { error } = await this.db.rpc('replace_role_area_type_scopes', {
      p_role_id: roleId,
      p_area_type_ids: areaTypeIds,
      p_actor_id: actorId,
    });
    if (error) databaseError(error, 'Không thể cập nhật Area Type Scope của role');
    return this.getRoleAreaTypeScopes(roleId);
  }

  async getUserRoles(userId: string) {
    const { data: user, error: userError } = await this.db
      .from('users').select('id').eq('id', userId).eq('is_deleted', false).maybeSingle();
    if (userError || !user) fail(404, 'Không tìm thấy người dùng');
    const { data, error } = await this.db
      .from('user_roles')
      .select(`role:roles!user_roles_role_id_fkey!inner(${ROLE_SELECT})`)
      .eq('user_id', userId)
      .eq('is_active', true)
      .eq('is_deleted', false)
      .eq('role.is_active', true)
      .eq('role.is_deleted', false);
    if (error) databaseError(error, 'Không thể lấy role của người dùng');
    return (data ?? []).map((row) => {
      const value = row.role as unknown;
      return Array.isArray(value) ? value[0] : value;
    }).filter(Boolean);
  }

  async replaceUserRoles(userId: string, body: ReplaceUserRolesBody, actorId: string) {
    const roleIds = [...new Set(body.role_ids)];
    if (roleIds.length === 0) fail(400, 'Người dùng phải có ít nhất một role');
    const { error } = await this.db.rpc('replace_user_roles', {
      p_user_id: userId,
      p_role_ids: roleIds,
      p_actor_id: actorId,
    });
    if (error) databaseError(error, 'Không thể cập nhật role của người dùng');
    return this.getUserRoles(userId);
  }
}
