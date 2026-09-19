export interface WorkShift {
  id: string;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  crosses_midnight: boolean;
  is_system: boolean;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkShiftUserSummary {
  id: string;
  vinfast_id: string;
  email: string;
  first_name: string;
  last_name: string;
}

export interface UserWorkShiftAssignment {
  id: string;
  user_id: string;
  work_shift_id: string;
  effective_from: string;
  effective_to: string | null;
  assigned_by: string;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  work_shift: WorkShift;
  user: WorkShiftUserSummary;
  assigned_by_user: WorkShiftUserSummary;
}

export interface UserWorkShiftAssignmentHistory {
  current: UserWorkShiftAssignment | null;
  history: UserWorkShiftAssignment[];
}

export interface AssignUserWorkShiftInput {
  user_id: string;
  work_shift_id: string;
  effective_from: string;
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
