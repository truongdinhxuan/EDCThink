import type { FastifyInstance } from 'fastify';
import type {
  AreaRecord,
  RoleRecord,
  UserRecord,
} from '../interfaces/database';
import type {
  CreateUserBody,
  UpdateUserBody,
  UserListQuery,
} from '../interfaces/users';
import { USER_COLUMNS } from '../interfaces/users';
import { USER_SORT_FIELDS } from '../schemas/users';
import { parsePagination, resolvePaginatedQueryResult } from '../utils/pagination';
import {
  hashPassword,
  isStrongPassword,
  PASSWORD_RULE_MESSAGE,
  verifyPassword,
} from '../utils/password';
import {
  AuthorizationError,
  getEffectivePermissions,
} from './authorization.service';
import { AuthSessionsService } from './auth-sessions.service';

interface SupabaseErrorLike {
  code?: string;
  message?: string;
}

export class UsersServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'UsersServiceError';
  }
}

const userFail = (statusCode: number, message: string): never => {
  throw new UsersServiceError(statusCode, message);
};

const userDatabaseError = (
  error: SupabaseErrorLike | null,
  fallback: string,
): never => {
  if (error?.code === 'PGRST116') return userFail(404, 'Không tìm thấy người dùng');
  if (error?.code === '23505') {
    if (/email/i.test(error.message ?? '')) return userFail(409, 'Email đã tồn tại');
    if (/vinfast/i.test(error.message ?? '')) return userFail(409, 'VinFast ID đã tồn tại');
    return userFail(409, 'Email hoặc VinFast ID đã tồn tại');
  }
  if (error?.code === '23503') {
    return userFail(400, 'role_id, area_id hoặc managed_by_user_id không hợp lệ');
  }
  return userFail(400, error?.message ?? fallback);
};

const normalizeRequiredText = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) userFail(400, `${field} không được để trống`);
  return normalized;
};

const normalizeNullableText = (
  value: string | null | undefined,
): string | null | undefined => {
  if (value === undefined || value === null) return value;
  return value.trim() || null;
};

const parseUserActiveFilter = (
  value: string | boolean | undefined,
): boolean | null => {
  if (value === undefined || value === '') return null;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return userFail(400, 'isActive phải là true hoặc false');
};

export const USER_COLUMN_SELECT = USER_COLUMNS.join(', ');

export const USER_EXPANDED_SELECT = `
  ${USER_COLUMN_SELECT},
  role:roles!users_role_id_fkey(id, code, name, is_active, is_deleted),
  area:areas!users_area_id_fkey(id, code, name, is_active),
  role_mappings:user_roles!user_roles_user_id_fkey(
    role_id, is_active, is_deleted,
    role:roles!user_roles_role_id_fkey(id, code, name, is_active, is_deleted)
  )
`;

const USER_EXPANDED_SELECT_FILTERED_BY_ROLE = `
  ${USER_EXPANDED_SELECT},
  role_filter:user_roles!user_roles_user_id_fkey!inner(role_id, is_active, is_deleted)
`;

interface UserProfileRecord extends UserRecord {
  role: Pick<RoleRecord, 'id' | 'code' | 'name' | 'is_active' | 'is_deleted'> | null;
  area: Pick<AreaRecord, 'id' | 'code' | 'name' | 'is_active'> | null;
  roles?: Array<Pick<RoleRecord, 'id' | 'code' | 'name' | 'is_active' | 'is_deleted'>>;
}

interface RawUserProfileRecord extends UserProfileRecord {
  role_mappings?: Array<{
    role_id: string;
    is_active: boolean;
    is_deleted: boolean;
    role: UserProfileRecord['role'];
  }>;
  role_filter?: unknown;
}

const normalizeUserProfile = (value: RawUserProfileRecord): UserProfileRecord => {
  const { role_mappings: mappings = [], role_filter: _roleFilter, ...profile } = value;
  return {
    ...profile,
    roles: mappings
      .filter((mapping) => mapping.is_active && !mapping.is_deleted)
      .map((mapping) => mapping.role)
      .filter((role): role is NonNullable<UserProfileRecord['role']> =>
        role !== null && role.is_active && !role.is_deleted),
  };
};

export class UsersService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get db() {
    return this.fastify.supabaseAdmin;
  }

  private async assertUniqueFields(
    email: string,
    vinfastId: string,
    excludeId?: string,
  ): Promise<void> {
    let emailQuery = this.db
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('email', email);
    let vinfastQuery = this.db
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('vinfast_id', vinfastId);

    if (excludeId) {
      emailQuery = emailQuery.neq('id', excludeId);
      vinfastQuery = vinfastQuery.neq('id', excludeId);
    }

    const [emailResult, vinfastResult] = await Promise.all([
      emailQuery,
      vinfastQuery,
    ]);
    if (emailResult.error) {
      userDatabaseError(emailResult.error, 'Không thể kiểm tra email');
    }
    if (vinfastResult.error) {
      userDatabaseError(vinfastResult.error, 'Không thể kiểm tra VinFast ID');
    }
    if ((emailResult.count ?? 0) > 0) userFail(409, 'Email đã tồn tại');
    if ((vinfastResult.count ?? 0) > 0) userFail(409, 'VinFast ID đã tồn tại');
  }

  private async assertConfiguredRoles(roleIds: string[]): Promise<void> {
    const uniqueRoleIds = [...new Set(roleIds)];
    if (uniqueRoleIds.length === 0) userFail(400, 'Người dùng phải có ít nhất một role');
    const { count, error } = await this.db
      .from('roles')
      .select('id', { count: 'exact', head: true })
      .in('id', uniqueRoleIds)
      .eq('is_active', true)
      .eq('is_deleted', false);
    if (error || count !== uniqueRoleIds.length) {
      userFail(400, 'Một hoặc nhiều role không tồn tại, inactive hoặc đã bị xóa');
    }
  }

  private async assertArea(areaId: string): Promise<void> {
    const { data, error } = await this.db
      .from('areas')
      .select('id')
      .eq('id', areaId)
      .eq('is_active', true)
      .eq('is_deleted', false)
      .single();
    if (error || !data) userFail(400, 'area_id không tồn tại hoặc không active');
  }

  private async assertManager(managerId: string): Promise<void> {
    const { data, error } = await this.db
      .from('users')
      .select('id')
      .eq('id', managerId)
      .eq('is_active', true)
      .eq('is_deleted', false)
      .single();
    if (error || !data) {
      userFail(400, 'managed_by_user_id không tồn tại hoặc không active');
    }
  }

  private async validateReferences(
    body: Pick<CreateUserBody, 'area_id' | 'managed_by_user_id'>
      | Pick<UpdateUserBody, 'area_id' | 'managed_by_user_id'>,
  ): Promise<void> {
    const checks: Promise<void>[] = [];
    if (body.area_id !== undefined) checks.push(this.assertArea(body.area_id));
    if (body.managed_by_user_id) checks.push(this.assertManager(body.managed_by_user_id));
    await Promise.all(checks);
  }

  async list(query: UserListQuery = {}) {
    const pagination = parsePagination(query, {
      allowedSortBy: USER_SORT_FIELDS,
      defaultSortBy: 'created_at',
      defaultSortOrder: 'desc',
    });
    const active = parseUserActiveFilter(query.isActive);
    let request = this.db
      .from('users')
      .select(query.roleId ? USER_EXPANDED_SELECT_FILTERED_BY_ROLE : USER_EXPANDED_SELECT, { count: 'exact' })
      .eq('is_deleted', false);
    if (pagination.search) {
      const conditions = [
        `email.ilike.*${pagination.search}*`,
        `first_name.ilike.*${pagination.search}*`,
        `last_name.ilike.*${pagination.search}*`,
        // vinfast_id is text now: match it partially like the other text columns
        // instead of casting, which would drop leading zeros.
        `vinfast_id.ilike.*${pagination.search}*`,
      ];
      request = request.or(conditions.join(','));
    }
    if (query.roleId) {
      request = request
        .eq('role_filter.role_id', query.roleId)
        .eq('role_filter.is_active', true)
        .eq('role_filter.is_deleted', false);
    }
    if (query.areaId) request = request.eq('area_id', query.areaId);
    if (active !== null) request = request.eq('is_active', active);
    request = request.order(pagination.sortBy, {
      ascending: pagination.sortOrder === 'asc',
    });
    if (pagination.sortBy !== 'id') request = request.order('id', { ascending: true });
    const { data, error, count } = await request.range(pagination.from, pagination.to);
    const result = resolvePaginatedQueryResult(
      {
        data: data ? (data as unknown as RawUserProfileRecord[]).map(normalizeUserProfile) : null,
        error,
        count,
      },
      pagination,
    );
    if (result) return result;
    if (error) userDatabaseError(error, 'Không thể lấy danh sách người dùng');
    throw new Error('Unreachable pagination state');
  }

  async get(id: string): Promise<UserProfileRecord> {
    const { data, error } = await this.db
      .from('users')
      .select(USER_EXPANDED_SELECT)
      .eq('id', id)
      .eq('is_deleted', false)
      .single();
    if (error || !data) userDatabaseError(error, 'Không tìm thấy người dùng');
    return normalizeUserProfile(data as unknown as RawUserProfileRecord);
  }

  async authenticate(
    vinfastId: string,
    password: string,
  ): Promise<UserProfileRecord> {
    const { data, error } = await this.db
      .from('users')
      .select(USER_EXPANDED_SELECT)
      .eq('vinfast_id', vinfastId)
      .maybeSingle();

    if (error) {
      this.fastify.log.error(error);
      userFail(500, 'Không thể xác thực tài khoản');
    }
    if (!data) {
      await hashPassword(password);
      return userFail(401, 'VinFast ID hoặc mật khẩu không đúng');
    }

    const profile = normalizeUserProfile(data as unknown as RawUserProfileRecord);
    const { data: credential, error: credentialError } = await this.db
      .from('user_credentials')
      .select('password_hash')
      .eq('user_id', profile.id)
      .maybeSingle();

    if (credentialError) {
      this.fastify.log.error(credentialError);
      userFail(500, 'Không thể xác thực tài khoản');
    }
    if (!credential) {
      await hashPassword(password);
      return userFail(401, 'VinFast ID hoặc mật khẩu không đúng');
    }

    if (!(await verifyPassword(password, credential.password_hash))) {
      return userFail(401, 'VinFast ID hoặc mật khẩu không đúng');
    }
    if (!profile.is_active || profile.is_deleted) {
      return userFail(403, 'Tài khoản không tồn tại hoặc đã bị khóa');
    }
    if (!profile.is_verified) {
      return userFail(
        403,
        'Tài khoản đang chờ duyệt và chưa được phép truy cập dữ liệu nội bộ',
      );
    }
    if (
      !profile.area_id ||
      !profile.role ||
      !profile.role.is_active ||
      profile.role.is_deleted
    ) {
      return userFail(403, 'Người dùng chưa được gán role hoặc area hợp lệ');
    }

    try {
      await getEffectivePermissions(this.fastify, profile.id);
    } catch (accessError) {
      if (accessError instanceof AuthorizationError) {
        return userFail(accessError.statusCode, accessError.message);
      }
      throw accessError;
    }

    return profile;
  }

  async create(body: CreateUserBody, actorId: string) {
    const email = normalizeRequiredText(body.email, 'email').toLowerCase();
    const firstName = normalizeRequiredText(body.first_name, 'first_name');
    const lastName = normalizeRequiredText(body.last_name, 'last_name');

    if (!isStrongPassword(body.password)) {
      return userFail(400, PASSWORD_RULE_MESSAGE);
    }
    await this.assertUniqueFields(email, body.vinfast_id);
    await this.assertConfiguredRoles(body.role_ids);
    await this.validateReferences({
      area_id: body.area_id,
      managed_by_user_id: body.managed_by_user_id,
    });

    const passwordHash = await hashPassword(body.password);
    const { data: userId, error: createError } = await this.db.rpc(
      'create_internal_user_with_roles',
      {
        p_email: email,
        p_first_name: firstName,
        p_last_name: lastName,
        p_vinfast_id: body.vinfast_id,
        p_phone_number: normalizeNullableText(body.phone_number) ?? null,
        p_avatar_url: normalizeNullableText(body.avatar_url) ?? null,
        p_role_ids: [...new Set(body.role_ids)],
        p_area_id: body.area_id,
        p_managed_by_user_id: body.managed_by_user_id ?? null,
        p_password_hash: passwordHash,
        p_actor_id: actorId,
      },
    );

    if (createError || typeof userId !== 'string') {
      userDatabaseError(
        createError,
        'Không thể tạo đồng thời hồ sơ và thông tin đăng nhập',
      );
    }

    const publicData = await this.get(userId);

    return {
      id: userId,
      email,
      publicData,
    };
  }

  async update(id: string, body: UpdateUserBody, _actorId?: string): Promise<UserProfileRecord> {
    const { data: current, error: currentError } = await this.db
      .from('users')
      .select(USER_COLUMN_SELECT)
      .eq('id', id)
      .eq('is_deleted', false)
      .single();
    const currentUser = current as unknown as UserRecord | null;
    if (currentError || !currentUser) {
      return userDatabaseError(currentError, 'Không tìm thấy người dùng');
    }

    await this.validateReferences(body);

    const payload: Record<string, unknown> = {};
    if (body.email !== undefined) {
      payload.email = normalizeRequiredText(body.email, 'email').toLowerCase();
    }
    if (body.first_name !== undefined) {
      payload.first_name = normalizeRequiredText(body.first_name, 'first_name');
    }
    if (body.last_name !== undefined) {
      payload.last_name = normalizeRequiredText(body.last_name, 'last_name');
    }
    if (body.vinfast_id !== undefined) payload.vinfast_id = body.vinfast_id;
    if (body.phone_number !== undefined) {
      payload.phone_number = normalizeNullableText(body.phone_number);
    }
    if (body.avatar_url !== undefined) {
      payload.avatar_url = normalizeNullableText(body.avatar_url);
    }
    if (body.area_id !== undefined) payload.area_id = body.area_id;
    if (body.managed_by_user_id !== undefined) {
      payload.managed_by_user_id = body.managed_by_user_id;
    }
    if (body.is_active !== undefined) payload.is_active = body.is_active;
    if (body.is_verified !== undefined) payload.is_verified = body.is_verified;
    if (body.is_deleted !== undefined) payload.is_deleted = body.is_deleted;

    if (Object.keys(payload).length === 0) userFail(400, 'Không có dữ liệu để cập nhật');

    const nextEmail = (payload.email as string | undefined) ?? currentUser.email;
    const nextVinfastId = (payload.vinfast_id as string | undefined) ?? currentUser.vinfast_id;
    if (nextEmail !== currentUser.email || nextVinfastId !== currentUser.vinfast_id) {
      await this.assertUniqueFields(nextEmail, nextVinfastId, id);
    }

    const { data, error } = await this.db
      .from('users')
      .update(payload)
      .eq('id', id)
      .select(USER_EXPANDED_SELECT)
      .single();

    if (error || !data) userDatabaseError(error, 'Không thể cập nhật người dùng');

    if (payload.is_active === false
        || payload.is_verified === false
        || payload.is_deleted === true) {
      await new AuthSessionsService(this.fastify).revokeAllForUser(id);
    }

    return normalizeUserProfile(data as unknown as RawUserProfileRecord);
  }

  async updatePassword(
    id: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    if (!isStrongPassword(newPassword)) {
      return userFail(400, PASSWORD_RULE_MESSAGE);
    }

    const { data: credential, error: credentialError } = await this.db
      .from('user_credentials')
      .select('password_hash')
      .eq('user_id', id)
      .maybeSingle();

    if (credentialError) userFail(500, 'Không thể kiểm tra mật khẩu hiện tại');
    if (
      !credential ||
      !(await verifyPassword(currentPassword, credential.password_hash))
    ) {
      return userFail(400, 'Sai mật khẩu hiện tại');
    }

    const passwordHash = await hashPassword(newPassword);
    const { error } = await this.db
      .from('user_credentials')
      .update({
        password_hash: passwordHash,
        password_changed_at: new Date().toISOString(),
      })
      .eq('user_id', id);

    if (error) userFail(500, 'Không thể cập nhật mật khẩu');
    await new AuthSessionsService(this.fastify).revokeAllForUser(id);
  }

  async setPassword(id: string, newPassword: string): Promise<void> {
    if (!isStrongPassword(newPassword)) {
      return userFail(400, PASSWORD_RULE_MESSAGE);
    }

    const { data: user, error: userError } = await this.db
      .from('users')
      .select('id')
      .eq('id', id)
      .eq('is_deleted', false)
      .maybeSingle();

    if (userError) userFail(500, 'Không thể kiểm tra người dùng');
    if (!user) userFail(404, 'Không tìm thấy người dùng');

    const passwordHash = await hashPassword(newPassword);
    const { error } = await this.db
      .from('user_credentials')
      .upsert(
        {
          user_id: id,
          password_hash: passwordHash,
          password_changed_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

    if (error) userFail(500, 'Không thể đặt mật khẩu người dùng');
    await new AuthSessionsService(this.fastify).revokeAllForUser(id);
  }

  async deactivate(id: string): Promise<UserProfileRecord> {
    const { data, error } = await this.db
      .from('users')
      .update({ is_active: false, is_deleted: true })
      .eq('id', id)
      .select(USER_EXPANDED_SELECT)
      .single();
    if (error || !data) userDatabaseError(error, 'Không tìm thấy người dùng');
    await new AuthSessionsService(this.fastify).revokeAllForUser(id);
    return normalizeUserProfile(data as unknown as RawUserProfileRecord);
  }
}

export const getUserProfileById = async (
  fastify: FastifyInstance,
  userId: string,
): Promise<UserProfileRecord | null> => {
  try {
    return await new UsersService(fastify).get(userId);
  } catch (error) {
    fastify.log.warn(
      `Không lấy được dữ liệu cho user ${userId}: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
    return null;
  }
};
