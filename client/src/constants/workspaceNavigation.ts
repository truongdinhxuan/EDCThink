import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faBuilding,
  faChartLine,
  faClipboardList,
  faClockRotateLeft,
  faDashboard,
  faLayerGroup,
  faLocationDot,
  // faRightLeft,
  faRulerCombined,
  faSliders,
  faTruck,
  faUserShield,
  faUsers,
  faWarehouse,
} from '@fortawesome/free-solid-svg-icons';
import type { RoleCode } from './roles';
import { PERMISSION_CODE, type PermissionCode } from './permissions';
import { getWorkspacePath } from './workspaces';

interface WorkspaceNavigationDefinition {
  path: string;
  label: string;
  icon: IconDefinition;
  permission?: PermissionCode;
  anyPermissions?: readonly PermissionCode[];
  allPermissions?: readonly PermissionCode[];
}

interface WorkspaceNavigationGroupDefinition {
  label: string;
  items: readonly WorkspaceNavigationDefinition[];
}

interface WorkspaceNavigationCatalogDefinition {
  label: string;
  groups: readonly WorkspaceNavigationGroupDefinition[];
}

export interface WorkspaceNavigationItem extends WorkspaceNavigationDefinition {
  to: string;
}

export interface WorkspaceNavigationGroup {
  label: string;
  items: readonly WorkspaceNavigationItem[];
}

export interface WorkspaceNavigationCatalog {
  label: string;
  groups: readonly WorkspaceNavigationGroup[];
}

const OVERVIEW_PERMISSIONS = [
  PERMISSION_CODE.SUPPLY_DASHBOARD_READ,
  // PERMISSION_CODE.MILKRUN_DASHBOARD_READ,
  PERMISSION_CODE.ADMIN_USER_READ,
] as const;

export const ORDER_READ_PERMISSIONS = [
  PERMISSION_CODE.SUPPLY_ORDER_CREATE,
  PERMISSION_CODE.SUPPLY_ORDER_APPROVE,
  PERMISSION_CODE.SUPPLY_ORDER_ALLOCATE,
  PERMISSION_CODE.SUPPLY_ORDER_CONFIRM_ALLOCATION,
  PERMISSION_CODE.SUPPLY_ORDER_ISSUE,
] as const;

const WORKSPACE_NAVIGATION: readonly WorkspaceNavigationCatalogDefinition[] = [
  {
    label: 'Overview',
    groups: [{
      label: 'Dashboard',
      items: [
        { path: 'dashboard', label: 'Tổng quan', icon: faDashboard, anyPermissions: OVERVIEW_PERMISSIONS },
        { path: 'dashboard/supply', label: 'Vật tư tiêu hao', icon: faChartLine, permission: PERMISSION_CODE.SUPPLY_DASHBOARD_READ },
        // { path: 'dashboard/milkrun', label: 'Milkrun', icon: faRoute, permission: PERMISSION_CODE.MILKRUN_DASHBOARD_READ },
      ],
    }],
  },
  {
    label: 'Vật tư tiêu hao',
    groups: [
      {
        label: 'Quản lý giao dịch',
        items: [
          // "Phiếu order ca" is the operational entry point for creating/reviewing
          // orders against the current shift; "Orders" is the historical/search
          // workspace. Direct "Tạo order" is demoted from the sidebar — the route
          // stays registered and stays reachable from "+ Thêm Order" on the Sheet.
          { path: 'shift-order-sheets', label: 'Phiếu order ca', icon: faClipboardList, permission: PERMISSION_CODE.SUPPLY_SHIFT_ORDER_SHEET_READ },
          { path: 'orders', label: 'Order lịch sử', icon: faClockRotateLeft, anyPermissions: ORDER_READ_PERMISSIONS },
          { path: 'stock-balances', label: 'Vật tư tồn kho', icon: faWarehouse, permission: PERMISSION_CODE.SUPPLY_STOCK_READ },
          { path: 'stock-transactions', label: 'Giao dịch vật tư', icon: faClockRotateLeft, permission: PERMISSION_CODE.SUPPLY_STOCK_READ },
          { path: 'stock-adjustments', label: 'Điều chỉnh giao dịch', icon: faSliders, permission: PERMISSION_CODE.SUPPLY_STOCK_ADJUST },
        ],
      },
      {
        label: 'Quản lý mã',
        items: [
          { path: 'supplies', label: 'Vật tư', icon: faTruck, permission: PERMISSION_CODE.SUPPLY_CATALOG_READ },
          { path: 'supply-categories', label: 'Loại vật tư', icon: faLayerGroup, permission: PERMISSION_CODE.SUPPLY_CATALOG_READ },
          { path: 'providers', label: 'Nhà cung cấp', icon: faBuilding, permission: PERMISSION_CODE.SUPPLY_CATALOG_READ },
          { path: 'units', label: 'Đơn vị', icon: faRulerCombined, permission: PERMISSION_CODE.SUPPLY_CATALOG_READ },
          { path: 'storage-locations', label: 'Khu vực lưu kho', icon: faLocationDot, permission: PERMISSION_CODE.SUPPLY_CATALOG_READ },
        ],
      },
    ],
  },

  /**
   *
   *
   *  Legacy Milkrun navigation (to be removed in the future)
   *
   */
  // {
  //   label: 'Milkrun',
  //   groups: [
  //     {
  //       label: 'Vận hành',
  //       items: [
  //         { path: 'milkrun/trips/create', label: 'Đăng ký chuyến', icon: faPlus, permission: PERMISSION_CODE.MILKRUN_TRIP_CREATE },
  //         { path: 'milkrun/trips/my', label: 'Chuyến đi của tôi', icon: faRoute, permission: PERMISSION_CODE.MILKRUN_TRIP_READ_OWN },
  //         { path: 'milkrun/trips', label: 'Tất cả chuyến đi', icon: faClipboardList, permission: PERMISSION_CODE.MILKRUN_TRIP_READ_ALL },
  //       ],
  //     },
  //     {
  //       label: 'Quản lý tồn',
  //       items: [
  //         { path: 'milkrun/stock', label: 'Tồn rack', icon: faWarehouse, permission: PERMISSION_CODE.MILKRUN_STOCK_READ },
  //         { path: 'milkrun/transactions', label: 'Giao dịch rack', icon: faClockRotateLeft, permission: PERMISSION_CODE.MILKRUN_STOCK_READ },
  //         { path: 'milkrun/adjustments', label: 'Cân / điều chỉnh tồn', icon: faSliders, permission: PERMISSION_CODE.MILKRUN_STOCK_ADJUST },
  //       ],
  //     },
  //     {
  //       label: 'Quản lý danh mục',
  //       items: [
  //         { path: 'milkrun/racks', label: 'Rack', icon: faLayerGroup, permission: PERMISSION_CODE.MILKRUN_RACK_READ },
  //         { path: 'milkrun/shops', label: 'Shop', icon: faBuilding, permission: PERMISSION_CODE.MILKRUN_SHOP_READ },
  //         { path: 'milkrun/trip-types', label: 'Loại chuyến', icon: faRightLeft, permission: PERMISSION_CODE.MILKRUN_TRIP_TYPE_READ },
  //         { path: 'milkrun/trip-statuses', label: 'Trạng thái chuyến', icon: faClockRotateLeft, permission: PERMISSION_CODE.MILKRUN_TRIP_STATUS_READ },
  //         { path: 'milkrun/vehicles', label: 'Xe', icon: faTruck, permission: PERMISSION_CODE.MILKRUN_VEHICLE_READ },
  //       ],
  //     },
  //     {
  //       label: 'Báo cáo',
  //       items: [
  //         { path: 'dashboard/milkrun', label: 'Dashboard Milkrun', icon: faChartLine, permission: PERMISSION_CODE.MILKRUN_DASHBOARD_READ },
  //       ],
  //     },
  //   ],
  // },
  {
    label: 'Tài khoản và phân quyền',
    groups: [{
      label: 'Hệ thống',
      items: [
        { path: 'users', label: 'Người dùng', icon: faUsers, permission: PERMISSION_CODE.ADMIN_USER_READ },
        { path: 'roles', label: 'Vai trò', icon: faUserShield, permission: PERMISSION_CODE.ADMIN_ROLE_READ },
        { path: 'areas', label: 'Khu vực', icon: faWarehouse, permission: PERMISSION_CODE.SUPPLY_AREA_READ },
      ],
    }],
  },
];

export const buildWorkspaceNavigation = (
  role: RoleCode | null,
  hasPermission: (permission: PermissionCode) => boolean,
  hasAnyPermission: (permissions: readonly PermissionCode[]) => boolean,
  hasAllPermissions: (permissions: readonly PermissionCode[]) => boolean,
): WorkspaceNavigationCatalog[] => WORKSPACE_NAVIGATION
  .map((catalog) => ({
    label: catalog.label,
    groups: catalog.groups
      .map((group) => ({
        label: group.label,
        items: group.items
          .filter((item) => (
            (!item.permission || hasPermission(item.permission))
            && (!item.anyPermissions || hasAnyPermission(item.anyPermissions))
            && (!item.allPermissions || hasAllPermissions(item.allPermissions))
          ))
          .map((item) => ({
            ...item,
            to: getWorkspacePath(role, item.path),
          })),
      }))
      .filter((group) => group.items.length > 0),
  }))
  .filter((catalog) => catalog.groups.length > 0);
