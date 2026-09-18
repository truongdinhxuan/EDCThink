import type { PaginationQuery } from './pagination';

export interface ShiftOrderSheetListQuery extends PaginationQuery {
  workDate?: string;
  workShiftId?: string;
  leaderId?: string;
  areaId?: string;
  statusId?: string;
  categoryId?: string;
}

export interface ShiftOrderSheetDetailQuery {
  search?: string;
  statusId?: string;
  categoryId?: string;
}

/** Shift instance the approver is currently working, taken from their Sheet context. */
export interface ShiftOrderSheetIncomingQuery {
  workDate: string;
  workShiftId: string;
}

export interface ShiftOrderSheetRelation {
  id: string;
  code: string;
  name: string;
}

export interface ShiftOrderSheetUser {
  id: string;
  vinfast_id: string;
  email: string;
  first_name: string;
  last_name: string;
}

export interface ShiftOrderSheetSummary {
  id: string;
  area_id: string;
  work_shift_id: string;
  work_date: string;
  leader_id: string;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  area: ShiftOrderSheetRelation | null;
  work_shift: ShiftOrderSheetRelation & {
    start_time: string;
    end_time: string;
    crosses_midnight: boolean;
  } | null;
  leader: ShiftOrderSheetUser | null;
  shift_start_at: string;
  shift_end_at: string;
  order_count: number;
  item_count: number;
}

export interface CurrentShiftOrderSheetContext {
  area_id: string;
  work_shift_id: string;
  work_date: string;
  area: ShiftOrderSheetRelation;
  work_shift: ShiftOrderSheetRelation;
  shift_start_at: string;
  shift_end_at: string;
  /** Server verdict: now sits outside [shift_start_at, shift_end_at]. */
  is_outside_working_hours: boolean;
  business_time_zone: 'Asia/Ho_Chi_Minh';
}
