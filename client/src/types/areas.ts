import type { AreaTypeSummary } from './area-scopes';

export interface Area {
  id: string;
  code: string;
  name: string;
  description: string | null;
  area_type_id: string | null;
  area_type: AreaTypeSummary | null;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

import type { PaginatedListParams } from './pagination.types';

export interface AreaListParams extends PaginatedListParams {
  isActive?: boolean;
  areaTypeId?: string;
}

export interface CreateAreaInput {
  code: string;
  name: string;
  description?: string | null;
  area_type_id?: string | null;
  is_active?: boolean;
}

export type UpdateAreaInput = Partial<CreateAreaInput>;
export type AreaOption = Area;
