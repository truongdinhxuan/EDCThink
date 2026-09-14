import type { PaginationQuery } from './pagination';

export interface PermissionListQuery extends PaginationQuery {
  module?: string;
}

export interface ReplaceRolePermissionsBody {
  permission_ids: string[];
}

export interface ReplaceUserRolesBody {
  role_ids: string[];
}

export interface ReplaceRoleAreaTypeScopesBody {
  areaTypeIds: string[];
}
