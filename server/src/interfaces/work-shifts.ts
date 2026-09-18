import type { UserWorkShiftAssignmentRecord, WorkShiftRecord } from './database';

export interface UserWorkShiftAssignmentQuery {
  user_id: string;
}

export interface AssignUserWorkShiftBody {
  user_id: string;
  work_shift_id: string;
  effective_from: string;
}

export interface WorkShiftUserSummary {
  id: string;
  vinfast_id: string;
  email: string;
  first_name: string;
  last_name: string;
}

export interface UserWorkShiftAssignment extends UserWorkShiftAssignmentRecord {
  work_shift: WorkShiftRecord;
  user: WorkShiftUserSummary;
  assigned_by_user: WorkShiftUserSummary;
}

export interface UserWorkShiftAssignmentHistory {
  current: UserWorkShiftAssignment | null;
  history: UserWorkShiftAssignment[];
}

export interface ResolvedWorkShiftInstance {
  assignment_id: string;
  work_shift_id: string;
  work_shift_code: string;
  work_date: string;
  shift_start_at: string;
  shift_end_at: string;
  is_overtime: boolean;
}
