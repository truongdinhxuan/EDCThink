import type { OrderStatus, StockTransactionType } from '../domain/enums';

export interface RoleRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface PermissionRecord {
  id: string;
  code: string;
  name: string;
  module: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface RolePermissionRecord {
  id: string;
  role_id: string;
  permission_id: string;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserRoleRecord {
  id: string;
  user_id: string;
  role_id: string;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuthSessionRecord {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  user_agent: string | null;
  ip_address: string | null;
  rotation_counter: number;
  created_at: string;
  updated_at: string;
}

export interface AreaRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  area_type_id: string | null;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface AreaTypeRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface RoleAreaTypeScopeRecord {
  id: string;
  role_id: string;
  area_type_id: string;
  created_at: string;
}

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

export interface WorkShiftRecord {
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

export interface UserWorkShiftAssignmentRecord {
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
}

export interface SupplyCategoryRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
}

export interface UnitRecord {
  id: string;
  code: string;
  symbol: string;
  name: string;
  description: string | null;
  is_active: boolean;
  updated_at: string;
  created_at: string;
  is_deleted: boolean;
}

export interface SupplyRecord {
  id: string;
  code: string;
  short_text: string;
  translation_text: string | null;
  description: string | null;
  category_id: string;
  unit_id: string;
  min_stock: number | null;
  max_stock: number | null;
  safety_stock: number | null;
  image_url: string | null;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProviderRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface SupplyProviderRecord {
  id: string;
  supply_id: string;
  provider_id: string;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface StorageLocationRecord {
  id: string;
  code: string;
  area_id: string;
  name: string | null;
  description: string | null;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface StockBalanceRecord {
  id: string;
  supply_id: string;
  provider_id: string;
  area_id: string;
  storage_location_id: string;
  quantity: number;
  set_per_qty: number | null;
  stack_quantity: number | null;
  total_set_quantity: number | null;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrderRecord {
  id: string;
  code: string;
  from_area_id: string;
  to_area_id: string;
  requested_by: string;
  approved_by: string | null;
  forklift_by: string | null;
  taken_away_by: string | null;
  status_id: string;
  shift_order_sheet_id: string | null;
  note: string | null;
  rejected_reason: string | null;
  cancel_reason: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  issued_at: string | null;
  received_at: string | null;
  completed_at: string | null;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface SupplyShiftOrderSheetRecord {
  id: string;
  area_id: string;
  work_shift_id: string;
  work_date: string;
  leader_id: string;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationRecord {
  id: string;
  domain: string;
  type: string;
  title: string;
  message: string;
  entity_type: string;
  entity_id: string;
  area_id: string | null;
  created_by: string | null;
  event_key: string;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationRecipientRecord {
  id: string;
  notification_id: string;
  user_id: string;
  is_read: boolean;
  read_at: string | null;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrderItemRecord {
  id: string;
  order_id: string;
  supply_id: string;
  provider_id: string;
  unit_id: string;
  quantity_requested: number;
  set_per_qty: number | null;
  requested_stack_quantity: number | null;
  requested_total_set_quantity: number | null;
  quantity_approved: number | null;
  quantity_issued: number | null;
  note: string | null;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrderItemAllocationRecord {
  id: string;
  order_item_id: string;
  stock_balance_id: string;
  expected_stack_quantity: number;
  actual_stack_quantity: number | null;
  status: string | null;
  discrepancy_reason: string | null;
  allocated_at: string;
  confirmed_at: string | null;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface InventoryDiscrepancyRecord {
  id: string;
  stock_balance_id: string;
  order_id: string;
  order_item_id: string;
  allocation_id: string;
  expected_stack_quantity: number;
  actual_stack_quantity: number;
  difference_stack_quantity: number;
  reason: string | null;
  status: 'OPEN' | 'RESOLVED';
  reported_by: string;
  reported_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface StockTransactionRecord {
  id: string;
  supply_id: string;
  provider_id: string;
  area_id: string;
  storage_location_id: string;
  order_id: string | null;
  order_item_id: string | null;
  inventory_discrepancy_id: string | null;
  transaction_type_id: string;
  quantity: number;
  before_quantity: number;
  after_quantity: number;
  set_per_qty: number | null;
  stack_quantity: number | null;
  before_stack_quantity: number | null;
  after_stack_quantity: number | null;
  reason_id: string | null;
  reason_note: string | null;
  note: string | null;
  created_by: string;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrderStatusRecord {
  id: string;
  code: OrderStatus;
  name: string;
  description: string | null;
  sort_order: number;
  is_system: boolean;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface StockTransactionTypeRecord {
  id: string;
  code: StockTransactionType;
  name: string;
  effect: 'INCREASE' | 'DECREASE' | 'NEUTRAL';
  requires_reason: boolean;
  is_system: boolean;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdjustmentReasonRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  requires_note: boolean;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrderRevisionActionRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrderRevisionRecord {
  id: string;
  order_id: string;
  action_id: string;
  old_status_id: string | null;
  new_status_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  reason: string | null;
  created_by: string;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface DatabaseRecordMap {
  auth_sessions: AuthSessionRecord;
  users: UserRecord;
  roles: RoleRecord;
  permissions: PermissionRecord;
  role_permissions: RolePermissionRecord;
  user_roles: UserRoleRecord;
  area_types: AreaTypeRecord;
  role_area_type_scopes: RoleAreaTypeScopeRecord;
  areas: AreaRecord;
  supply_categories: SupplyCategoryRecord;
  units: UnitRecord;
  supplies: SupplyRecord;
  providers: ProviderRecord;
  supply_providers: SupplyProviderRecord;
  storage_locations: StorageLocationRecord;
  stock_balances: StockBalanceRecord;
  orders: OrderRecord;
  supply_shift_order_sheets: SupplyShiftOrderSheetRecord;
  notifications: NotificationRecord;
  notification_recipients: NotificationRecipientRecord;
  order_items: OrderItemRecord;
  order_item_allocations: OrderItemAllocationRecord;
  inventory_discrepancies: InventoryDiscrepancyRecord;
  stock_transactions: StockTransactionRecord;
  order_statuses: OrderStatusRecord;
  stock_transaction_types: StockTransactionTypeRecord;
  adjustment_reasons: AdjustmentReasonRecord;
  order_revision_actions: OrderRevisionActionRecord;
  order_revisions: OrderRevisionRecord;
}

export type FoundationTableName = keyof DatabaseRecordMap;
