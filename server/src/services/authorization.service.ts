import type { FastifyInstance } from 'fastify';
import type {} from '../plugins/dbContext';
import {
  isPermissionCode,
  type PermissionCode,
} from '../domain/permission-codes';

interface UserAccessRow {
  id: string;
  email: string;
  area_id: string | null;
  is_active: boolean;
  is_verified: boolean;
  is_deleted: boolean;
}

interface SessionAccessRow {
  id: string;
  user_id: string;
  expires_at: string;
  revoked_at: string | null;
  user: UserAccessRow | UserAccessRow[] | null;
}

interface RoleAccessRow {
  id: string;
  code: string;
  name: string;
  is_system: boolean;
  is_active: boolean;
  is_deleted: boolean;
}

interface UserRoleAccessRow {
  user_id?: string;
  role_id: string;
  is_active: boolean;
  is_deleted: boolean;
  role: RoleAccessRow | RoleAccessRow[] | null;
}

interface PermissionAccessRow {
  code: string;
  is_active: boolean;
  is_deleted: boolean;
}

interface RolePermissionAccessRow {
  role_id: string;
  is_active: boolean;
  is_deleted: boolean;
  permission: PermissionAccessRow | PermissionAccessRow[] | null;
}

export interface AuthorizationContext {
  userId: string;
  email: string;
  areaId: string;
  roleIds: string[];
  permissions: PermissionCode[];
  isSystemAdmin: boolean;
}

export class AuthorizationError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

const firstRelation = <T>(value: T | T[] | null): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : value;

export const resolveEffectivePermissions = (
  user: UserAccessRow,
  userRoles: UserRoleAccessRow[],
  rolePermissions: RolePermissionAccessRow[],
): AuthorizationContext => {
  if (!user.is_active || user.is_deleted) {
    throw new AuthorizationError(403, 'Hồ sơ người dùng không tồn tại hoặc đã bị khóa');
  }
  if (!user.is_verified) {
    throw new AuthorizationError(
      403,
      'Tài khoản chưa được duyệt để truy cập dữ liệu nội bộ',
    );
  }
  if (!user.area_id) {
    throw new AuthorizationError(403, 'Người dùng chưa được gán area hợp lệ');
  }

  const activeRoles = userRoles
    .filter((mapping) => mapping.is_active && !mapping.is_deleted)
    .map((mapping) => firstRelation(mapping.role))
    .filter((role): role is RoleAccessRow =>
      role !== null && role.is_active && !role.is_deleted);

  if (activeRoles.length === 0) {
    throw new AuthorizationError(403, 'Người dùng chưa được gán role hợp lệ');
  }

  const roleIds = [...new Set(activeRoles.map((role) => role.id))];
  const roleIdSet = new Set(roleIds);
  const permissions = [...new Set(
    rolePermissions
      .filter((mapping) =>
        roleIdSet.has(mapping.role_id)
        && mapping.is_active
        && !mapping.is_deleted)
      .map((mapping) => firstRelation(mapping.permission))
      .filter((permission): permission is PermissionAccessRow & { code: PermissionCode } =>
        permission !== null
        && permission.is_active
        && !permission.is_deleted
        && isPermissionCode(permission.code))
      .map((permission) => permission.code),
  )];

  return {
    userId: user.id,
    email: user.email,
    areaId: user.area_id,
    roleIds,
    permissions,
    isSystemAdmin: activeRoles.some(
      (role) => role.code === 'ADMIN' && role.is_system === true,
    ),
  };
};

const databaseFailure = (message: string): never => {
  throw new AuthorizationError(500, message);
};

export const getEffectivePermissions = async (
  fastify: FastifyInstance,
  userId: string,
  sessionId?: string,
): Promise<AuthorizationContext> => {
  let userData: UserAccessRow | null = null;
  if (sessionId) {
    const { data, error } = await fastify.supabaseAdmin
      .from('auth_sessions')
      .select(`
        id, user_id, expires_at, revoked_at,
        user:users!auth_sessions_user_id_fkey!inner(
          id, email, area_id, is_active, is_verified, is_deleted
        )
      `)
      .eq('id', sessionId)
      .eq('user_id', userId)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error) databaseFailure('Không thể xác minh phiên đăng nhập');
    const session = data as unknown as SessionAccessRow | null;
    if (!session) {
      throw new AuthorizationError(401, 'Phiên đăng nhập đã hết hạn hoặc bị thu hồi');
    }
    userData = firstRelation(session.user);
  } else {
    const { data, error } = await fastify.supabaseAdmin
      .from('users')
      .select('id, email, area_id, is_active, is_verified, is_deleted')
      .eq('id', userId)
      .maybeSingle();
    if (error) databaseFailure('Không thể tải hồ sơ phân quyền người dùng');
    userData = data as UserAccessRow | null;
  }

  if (!userData) {
    throw new AuthorizationError(403, 'Hồ sơ người dùng không tồn tại hoặc đã bị khóa');
  }

  const { data: userRoleData, error: userRoleError } = await fastify.supabaseAdmin
    .from('user_roles')
    .select(`
      role_id, is_active, is_deleted,
      role:roles!user_roles_role_id_fkey!inner(
        id, code, name, is_system, is_active, is_deleted
      )
    `)
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('is_deleted', false)
    .eq('role.is_active', true)
    .eq('role.is_deleted', false);

  if (userRoleError) databaseFailure('Không thể tải role của người dùng');

  const userRoles = (userRoleData ?? []) as unknown as UserRoleAccessRow[];
  const roleIds = [...new Set(userRoles.map((mapping) => mapping.role_id))];
  let rolePermissionRows: RolePermissionAccessRow[] = [];

  if (roleIds.length > 0) {
    const { data, error } = await fastify.supabaseAdmin
      .from('role_permissions')
      .select(`
        role_id, is_active, is_deleted,
        permission:permissions!role_permissions_permission_id_fkey!inner(
          code, is_active, is_deleted
        )
      `)
      .in('role_id', roleIds)
      .eq('is_active', true)
      .eq('is_deleted', false)
      .eq('permission.is_active', true)
      .eq('permission.is_deleted', false);

    if (error) databaseFailure('Không thể tải permission của người dùng');
    rolePermissionRows = (data ?? []) as unknown as RolePermissionAccessRow[];
  }

  return resolveEffectivePermissions(
    userData,
    userRoles,
    rolePermissionRows,
  );
};

/**
 * Resolves all active application principals in three bounded database reads.
 * Notification fan-out uses this instead of one permission query per user.
 */
export const getActiveAuthorizationContexts = async (
  fastify: FastifyInstance,
): Promise<AuthorizationContext[]> => {
  const { data: usersData, error: usersError } = await fastify.supabaseAdmin
    .from('users')
    .select('id, email, area_id, is_active, is_verified, is_deleted')
    .eq('is_active', true)
    .eq('is_verified', true)
    .eq('is_deleted', false);
  if (usersError) databaseFailure('Không thể tải danh sách người dùng nhận thông báo');

  const users = (usersData ?? []) as UserAccessRow[];
  if (users.length === 0) return [];
  const userIds = users.map((user) => user.id);

  const { data: mappingsData, error: mappingsError } = await fastify.supabaseAdmin
    .from('user_roles')
    .select(`
      user_id, role_id, is_active, is_deleted,
      role:roles!user_roles_role_id_fkey!inner(
        id, code, name, is_system, is_active, is_deleted
      )
    `)
    .in('user_id', userIds)
    .eq('is_active', true)
    .eq('is_deleted', false)
    .eq('role.is_active', true)
    .eq('role.is_deleted', false);
  if (mappingsError) databaseFailure('Không thể tải role của người nhận thông báo');

  const mappings = (mappingsData ?? []) as unknown as UserRoleAccessRow[];
  const roleIds = [...new Set(mappings.map((mapping) => mapping.role_id))];
  let rolePermissions: RolePermissionAccessRow[] = [];
  if (roleIds.length > 0) {
    const { data, error } = await fastify.supabaseAdmin
      .from('role_permissions')
      .select(`
        role_id, is_active, is_deleted,
        permission:permissions!role_permissions_permission_id_fkey!inner(
          code, is_active, is_deleted
        )
      `)
      .in('role_id', roleIds)
      .eq('is_active', true)
      .eq('is_deleted', false)
      .eq('permission.is_active', true)
      .eq('permission.is_deleted', false);
    if (error) databaseFailure('Không thể tải permission của người nhận thông báo');
    rolePermissions = (data ?? []) as unknown as RolePermissionAccessRow[];
  }

  const contexts: AuthorizationContext[] = [];
  for (const user of users) {
    const userMappings = mappings.filter((mapping) => mapping.user_id === user.id);
    const userRoleIds = new Set(userMappings.map((mapping) => mapping.role_id));
    try {
      contexts.push(resolveEffectivePermissions(
        user,
        userMappings,
        rolePermissions.filter((mapping) => userRoleIds.has(mapping.role_id)),
      ));
    } catch (error) {
      if (!(error instanceof AuthorizationError) || error.statusCode >= 500) throw error;
    }
  }
  return contexts;
};

export const hasPermission = (
  access: Pick<AuthorizationContext, 'permissions' | 'isSystemAdmin'>,
  permissionCode: PermissionCode,
): boolean => access.isSystemAdmin || access.permissions.includes(permissionCode);
