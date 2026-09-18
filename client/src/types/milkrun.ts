import type { PaginatedListParams } from './pagination.types';

export const MILKRUN_TRIP_STATUS = {
  REGISTERED: 'REGISTERED',
  STARTED: 'STARTED',
  ARRIVED: 'ARRIVED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

export type MilkrunTripStatusCode =
  (typeof MILKRUN_TRIP_STATUS)[keyof typeof MILKRUN_TRIP_STATUS];

export interface MilkrunLookup {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  is_active?: boolean;
  is_deleted?: boolean;
}

export interface MilkrunRack extends MilkrunLookup {
  image_url: string | null;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface MilkrunTripStatus extends MilkrunLookup {
  sort_order: number;
}

export interface MilkrunDriverSummary {
  id: string;
  vinfast_id: string;
  first_name: string;
  last_name: string;
  email: string;
  avatar_url: string | null;
  is_active?: boolean;
  is_deleted?: boolean;
}

export interface MilkrunAreaSummary {
  id: string;
  code: string;
  name: string;
}

export interface MilkrunTripItem {
  id: string;
  trip_id: string;
  rack_id: string;
  quantity: number;
  note: string | null;
  rack: MilkrunRack | null;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface MilkrunTrip {
  id: string;
  code: string;
  driver_id: string;
  area_id: string;
  shop_id: string;
  trip_type_id: string;
  status_id: string;
  time_start: string | null;
  time_arrived: string | null;
  time_lift_up: string | null;
  time_lift_down: string | null;
  attachment_url: string | null;
  note: string | null;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  driver: MilkrunDriverSummary | null;
  area: MilkrunAreaSummary | null;
  shop: MilkrunLookup | null;
  trip_type: MilkrunLookup | null;
  status: MilkrunTripStatus | null;
  items?: MilkrunTripItem[];
}

export interface MilkrunTripItemInput {
  rack_id: string;
  quantity: number;
  note?: string | null;
}

export interface CreateMilkrunTripInput {
  shop_id: string;
  trip_type_id: string;
  attachment_url?: string | null;
  note?: string | null;
  items: MilkrunTripItemInput[];
}

export interface MilkrunTripListParams extends PaginatedListParams {
  status?: string;
  statusId?: string;
  shopId?: string;
  tripTypeId?: string;
  driverId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface MilkrunLookupListParams extends PaginatedListParams {
  isActive?: boolean;
  isDeleted?: boolean;
}

export interface MilkrunMasterRecord extends MilkrunLookup {
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface MilkrunSystemLookup extends MilkrunMasterRecord {
  is_system: boolean;
}

export interface MilkrunShop extends MilkrunMasterRecord {
  description: string | null;
}

export interface MilkrunTripType extends MilkrunShop {
  is_system: boolean;
}

export interface MilkrunTripStatusRecord extends MilkrunTripType {
  sort_order: number;
}

export interface MilkrunVehicle extends Omit<MilkrunMasterRecord, 'name'> {
  plate_number: string;
  driver_id: string | null;
  name: string | null;
  driver: MilkrunDriverSummary | null;
}

export interface MilkrunStockTransactionType extends MilkrunSystemLookup {
  effect: 'INCREASE' | 'DECREASE' | 'NEUTRAL';
  requires_reason: boolean;
}

export interface MilkrunAdjustmentReason extends MilkrunMasterRecord {
  description: string | null;
}

export interface MilkrunStockBalance {
  id: string;
  rack_id: string;
  area_id: string;
  quantity: number;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  rack: MilkrunRack | null;
  area: MilkrunAreaSummary | null;
}

export interface MilkrunStockTransaction {
  id: string;
  rack_id: string;
  area_id: string;
  trip_id: string | null;
  trip_item_id: string | null;
  transaction_type_id: string;
  adjustment_reason_id: string | null;
  quantity: number;
  before_quantity: number;
  after_quantity: number;
  reason_note: string | null;
  created_by: string | null;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  rack: MilkrunRack | null;
  area: MilkrunAreaSummary | null;
  transaction_type: MilkrunStockTransactionType | null;
  adjustment_reason: MilkrunAdjustmentReason | null;
  creator: MilkrunDriverSummary | null;
}

export interface MilkrunStockBalanceListParams extends PaginatedListParams {
  rackId?: string;
  areaId?: string;
}

export interface MilkrunStockTransactionListParams extends PaginatedListParams {
  rackId?: string;
  areaId?: string;
  transactionTypeId?: string;
  adjustmentReasonId?: string;
  createdBy?: string;
  tripId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface CreateMilkrunStockAdjustmentInput {
  rack_id: string;
  transaction_type_id: string;
  adjustment_reason_id: string;
  quantity: number;
  reason_note?: string | null;
}

export interface MilkrunRackInput {
  code: string;
  name: string;
  image_url?: string | null;
  is_active?: boolean;
}

export interface MilkrunShopInput {
  code: string;
  name: string;
  description?: string | null;
  is_active?: boolean;
}

export type MilkrunTripTypeInput = MilkrunShopInput;

export interface MilkrunTripStatusInput extends MilkrunShopInput {
  sort_order: number;
}

export interface MilkrunVehicleInput {
  code?: string;
  plate_number?: string;
  driver_id?: string | null;
  name?: string | null;
  is_active?: boolean;
}

export interface MilkrunDashboardParams {
  dateFrom?: string;
  dateTo?: string;
  driverId?: string;
  shopId?: string;
  statusId?: string;
}

export interface MilkrunDashboardShopMetric {
  id: string;
  code: string;
  name: string;
  trip_count: number;
}

export interface MilkrunDashboardDriverMetric extends MilkrunDriverSummary {
  trip_count: number;
}

export interface MilkrunDashboardDriverTimeMetric extends MilkrunDriverSummary {
  visit_count: number;
  total_minutes: number;
  average_minutes: number;
}

export interface MilkrunDashboardRackMetric {
  id: string;
  code: string;
  name: string;
  quantity: number;
}

export interface MilkrunDashboard {
  total_trips: number;
  top_shop: MilkrunDashboardShopMetric | null;
  trips_by_driver: MilkrunDashboardDriverMetric[];
  driver_shop_time: MilkrunDashboardDriverTimeMetric[];
  trip_duration: {
    trip_count: number;
    average_minutes: number | null;
  };
  top_received_rack: MilkrunDashboardRackMetric | null;
  top_returned_rack: MilkrunDashboardRackMetric | null;
  current_stock: {
    total_quantity: number;
    racks: MilkrunDashboardRackMetric[];
  };
  adjustment_count: number;
}
