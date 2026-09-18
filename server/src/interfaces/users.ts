import type { PaginationQuery } from './pagination';

export const USER_COLUMNS = [
  'id',
  'vinfast_id',
  'email',
  'phone_number',
  'avatar_url',
  'role_id',
  'area_id',
  'managed_by_user_id',
  'is_active',
  'is_verified',
  'is_deleted',
  'created_at',
  'updated_at',
  'first_name',
  'last_name',
] as const;

export interface LoginBody {
  vinfast_id: string;
  password: string;
}

export interface UserListQuery extends PaginationQuery {
  roleId?: string;
  areaId?: string;
  isActive?: string | boolean;
}

export interface CreateUserBody {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  vinfast_id: string;
  phone_number?: string | null;
  avatar_url?: string | null;
  role_ids: string[];
  area_id: string;
  managed_by_user_id?: string | null;
}

export interface UpdateUserBody {
  email?: string;
  first_name?: string;
  last_name?: string;
  vinfast_id?: string;
  phone_number?: string | null;
  avatar_url?: string | null;
  area_id?: string;
  managed_by_user_id?: string | null;
  is_active?: boolean;
  is_verified?: boolean;
  is_deleted?: boolean;
}
