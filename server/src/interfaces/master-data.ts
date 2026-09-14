import type { PaginationQuery } from './pagination';

export interface ActiveListQuery extends PaginationQuery {
  is_active?: string | boolean;
  isActive?: string | boolean;
  q?: string;
}

export interface AreaListQuery extends ActiveListQuery {
  areaTypeId?: string;
}

export interface SearchListQuery extends PaginationQuery {
  q?: string;
}

export interface RoleListQuery extends PaginationQuery {
  isActive?: string | boolean;
}

export interface CreateRoleBody {
  code: string;
  name: string;
  description?: string | null;
  is_active?: boolean;
}

export type UpdateRoleBody = Partial<CreateRoleBody>;

export interface CreateAreaBody {
  code: string;
  name: string;
  description?: string | null;
  area_type_id?: string | null;
  is_active?: boolean;
}

export type UpdateAreaBody = Partial<CreateAreaBody>;

export interface CreateSupplyCategoryBody {
  code: string;
  name: string;
  description?: string | null;
  is_active?: boolean;
}

export type UpdateSupplyCategoryBody = Partial<CreateSupplyCategoryBody>;

export interface CreateUnitBody {
  code: string;
  symbol: string;
  name: string;
  description?: string | null;
  is_active?: boolean;
}

export type UpdateUnitBody = Partial<CreateUnitBody>;
