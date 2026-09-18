import type { Area } from './areas';
import type { PaginatedListParams } from './pagination.types';

export interface RoleSummary {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  is_deleted: boolean;
}

export type AreaSummary = Pick<Area, 'id' | 'code' | 'name'>;

export interface UserRecord {
  id: string;
  vinfast_id: string;
  email: string;
  phone_number: string | null;
  avatar_url: string | null;
  role_id: string;
  area_id: string;
  managed_by_user_id: string | null;
  is_active: boolean;
  is_verified: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  first_name: string;
  last_name: string;
}

export interface UserProfile extends UserRecord {
  role: RoleSummary | string | null;
  roles?: RoleSummary[];
  area: AreaSummary | null;
}

export interface IUser {
  id?: string;
  email?: string;
  publicData: UserProfile;
  roleIds?: string[];
  permissions?: string[];
  isSystemAdmin?: boolean;
}

export interface AuthSessionResponse extends IUser {
  accessToken: string;
  message?: string;
}

export type LoginResponse = AuthSessionResponse;
export type RefreshResponse = AuthSessionResponse;

export interface UserListParams extends PaginatedListParams {
  roleId?: string;
  areaId?: string;
  isActive?: boolean;
}

export interface UserDataResponse {
  message: string;
  data: UserProfile;
}

export interface CreateUserInput {
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

export type UpdateUserInput = Partial<Omit<CreateUserInput, 'password' | 'role_ids'>> & {
  is_active?: boolean;
  is_verified?: boolean;
  is_deleted?: boolean;
};

export interface UpdateUserPasswordInput {
  currentPassword?: string;
  newPassword: string;
  confirmNewPassword: string;
}

export interface UserMessageResponse {
  message: string;
}

export interface CreateUserResponse {
  message: string;
  data: {
    id: string;
    email: string;
    publicData: UserProfile;
  };
}

export const canAccessInternalData = (user: UserProfile): boolean =>
  user.is_active && user.is_verified && !user.is_deleted;
