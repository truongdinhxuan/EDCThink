/* eslint-disable react-refresh/only-export-components */
import { lazy, type ReactNode } from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import { PermissionGuard } from '../components/PermissionGuard';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { PERMISSION_CODE, type PermissionCode } from '../constants/permissions';
import { ROLE_CODES, type RoleCode } from '../constants/roles';
import { ROLE_WORKSPACES } from '../constants/workspaces';
import { ORDER_READ_PERMISSIONS } from '../constants/workspaceNavigation';

const WorkspaceLayout = lazy(() => import('../layouts/workspace/WorkspaceLayout').then((module) => ({ default: module.WorkspaceLayout })));
const RoleDashboardPage = lazy(() => import('../pages/dashboards/RoleDashboardPage'));
const UsersPage = lazy(() => import('../pages/management/UsersPage'));
const RolesPage = lazy(() => import('../pages/management/RolesPage'));
const AreasPage = lazy(() => import('../pages/management/AreasPage'));
const SuppliesPage = lazy(() => import('../pages/catalog/SuppliesPage'));
const ProvidersPage = lazy(() => import('../pages/catalog/ProvidersPage'));
const SupplyCategoriesPage = lazy(() => import('../pages/catalog/SupplyCategoriesPage'));
const UnitsPage = lazy(() => import('../pages/catalog/UnitsPage'));
const StorageLocationsPage = lazy(() => import('../pages/catalog/StorageLocationsPage'));
const StockBalancesPage = lazy(() => import('../pages/stock/StockBalancesPage'));
const StockTransactionsPage = lazy(() => import('../pages/stock/StockTransactionsPage'));
// const MilkrunTripsPage = lazy(() => import('../pages/milkrun/TripsListPage'));
// const CreateMilkrunTripPage = lazy(() => import('../pages/milkrun/CreateTripPage'));
// const MilkrunTripDetailPage = lazy(() => import('../pages/milkrun/TripDetailPage'));
// const MilkrunDashboardPage = lazy(() => import('../pages/milkrun/DashboardPage'));
// const MilkrunStockBalancesPage = lazy(() => import('../pages/milkrun/StockBalancesPage'));
// const MilkrunStockTransactionsPage = lazy(() => import('../pages/milkrun/StockTransactionsPage'));
// const MilkrunStockAdjustmentPage = lazy(() => import('../pages/milkrun/StockAdjustmentPage'));
// const MilkrunRacksPage = lazy(() => import('../pages/milkrun/RacksPage'));
// const MilkrunShopsPage = lazy(() => import('../pages/milkrun/ShopsPage'));
// const MilkrunTripCatalogPage = lazy(() => import('../pages/milkrun/TripCatalogPage'));
// const MilkrunVehiclesPage = lazy(() => import('../pages/milkrun/VehiclesPage'));
const WorkspacePlaceholderPage = lazy(() => import('../pages/operations/WorkspacePlaceholderPage'));
const OrdersListPage = lazy(() => import('../pages/orders/OrdersListPage'));
const CreateOrderPage = lazy(() => import('../pages/orders/CreateOrderPage'));
const OrderDetailPage = lazy(() => import('../pages/orders/OrderDetailPage'));
const ShiftOrderSheetsPage = lazy(() => import('../pages/orders/ShiftOrderSheetsPage'));
const ShiftOrderSheetDetailPage = lazy(() => import('../pages/orders/ShiftOrderSheetDetailPage'));

const guarded = (permissions: readonly PermissionCode[], element: ReactNode) => (
  <PermissionGuard anyOf={permissions}>{element}</PermissionGuard>
);

// const milkrunTripReadPermissions = [
//   PERMISSION_CODE.MILKRUN_TRIP_READ_OWN,
//   PERMISSION_CODE.MILKRUN_TRIP_READ_ALL,
// ] as const;

// const MilkrunIndexRedirect = () => {
//   const { hasPermission } = useAuth();
//   return (
//     <Navigate
//       to={hasPermission(PERMISSION_CODE.MILKRUN_TRIP_READ_ALL) ? 'trips' : 'trips/my'}
//       replace
//     />
//   );
// };

const createFeatureRoutes = (role?: RoleCode): RouteObject[] => [
  { index: true, element: <Navigate to="dashboard" replace /> },
  { path: 'dashboard', element: <RoleDashboardPage workspaceRole={role} /> },
  { path: 'dashboard/supply', element: guarded([PERMISSION_CODE.SUPPLY_DASHBOARD_READ], <RoleDashboardPage workspaceRole={role} />) },
  // { path: 'dashboard/milkrun', element: guarded([PERMISSION_CODE.MILKRUN_DASHBOARD_READ], <MilkrunDashboardPage />) },
  { path: 'supplies', element: guarded([PERMISSION_CODE.SUPPLY_CATALOG_READ], <SuppliesPage />) },
  { path: 'providers', element: guarded([PERMISSION_CODE.SUPPLY_CATALOG_READ], <ProvidersPage />) },
  { path: 'supply-categories', element: guarded([PERMISSION_CODE.SUPPLY_CATALOG_READ], <SupplyCategoriesPage />) },
  { path: 'units', element: guarded([PERMISSION_CODE.SUPPLY_CATALOG_READ], <UnitsPage />) },
  { path: 'storage-locations', element: guarded([PERMISSION_CODE.SUPPLY_CATALOG_READ], <StorageLocationsPage />) },
  { path: 'areas', element: guarded([PERMISSION_CODE.SUPPLY_AREA_READ], <AreasPage />) },
  { path: 'orders', element: guarded(ORDER_READ_PERMISSIONS, <OrdersListPage />) },
  { path: 'orders/create', element: guarded([PERMISSION_CODE.SUPPLY_ORDER_CREATE], <CreateOrderPage />) },
  { path: 'orders/:id', element: guarded(ORDER_READ_PERMISSIONS, <OrderDetailPage />) },
  { path: 'shift-order-sheets', element: guarded([PERMISSION_CODE.SUPPLY_SHIFT_ORDER_SHEET_READ], <ShiftOrderSheetsPage />) },
  { path: 'shift-order-sheets/:id', element: guarded([PERMISSION_CODE.SUPPLY_SHIFT_ORDER_SHEET_READ], <ShiftOrderSheetDetailPage />) },
  { path: 'stock-balances', element: guarded([PERMISSION_CODE.SUPPLY_STOCK_READ], <StockBalancesPage />) },
  { path: 'stock-transactions', element: guarded([PERMISSION_CODE.SUPPLY_STOCK_READ], <StockTransactionsPage />) },
  {
    path: 'stock-adjustments',
    element: guarded([PERMISSION_CODE.SUPPLY_STOCK_ADJUST], (
      <WorkspacePlaceholderPage title="Stock adjustments" description="Điều chỉnh tồn ngoài order và bắt buộc nhập lý do." />
    )),
  },
  // {
  //   path: 'stock-transfers',
  //   element: guarded([PERMISSION_CODE.SUPPLY_STOCK_ADJUST], (
  //     <WorkspacePlaceholderPage title="Stock transfers" description="Chuyển vật tư giữa các vị trí với transaction OUT/IN." />
  //   )),
  // },
  {
    path: 'stock-transfers',
    element: guarded([PERMISSION_CODE.SUPPLY_STOCK_ADJUST], (
      <WorkspacePlaceholderPage title="Stock transfers" description="Chuyển vật tư giữa các vị trí với transaction OUT/IN." />
    )),
  },

/**
 *
 *
 *  Legacy Milkrun routes (to be removed in the future)
 *
 */

  // { path: 'milkrun', element: <MilkrunIndexRedirect /> },
  // { path: 'milkrun/trips', element: guarded([PERMISSION_CODE.MILKRUN_TRIP_READ_ALL], <MilkrunTripsPage scope="all" />) },
  // { path: 'milkrun/trips/my', element: guarded([PERMISSION_CODE.MILKRUN_TRIP_READ_OWN], <MilkrunTripsPage scope="own" />) },
  // { path: 'milkrun/trips/create', element: guarded([PERMISSION_CODE.MILKRUN_TRIP_CREATE], <CreateMilkrunTripPage />) },
  // { path: 'milkrun/trips/:id', element: guarded(milkrunTripReadPermissions, <MilkrunTripDetailPage />) },
  // {
  //   path: 'milkrun/stock',
  //   element: guarded([PERMISSION_CODE.MILKRUN_STOCK_READ], <MilkrunStockBalancesPage />),
  // },
  // {
  //   path: 'milkrun/transactions',
  //   element: guarded([PERMISSION_CODE.MILKRUN_STOCK_READ], <MilkrunStockTransactionsPage />),
  // },
  // {
  //   path: 'milkrun/adjustments',
  //   element: guarded([PERMISSION_CODE.MILKRUN_STOCK_ADJUST], <MilkrunStockAdjustmentPage />),
  // },
  // {
  //   path: 'milkrun/racks',
  //   element: guarded([PERMISSION_CODE.MILKRUN_RACK_READ], <MilkrunRacksPage />),
  // },
  // {
  //   path: 'milkrun/shops',
  //   element: guarded([PERMISSION_CODE.MILKRUN_SHOP_READ], <MilkrunShopsPage />),
  // },
  // {
  //   path: 'milkrun/trip-types',
  //   element: guarded([PERMISSION_CODE.MILKRUN_TRIP_TYPE_READ], <MilkrunTripCatalogPage key="trip-types" resourceName="trip-types" />),
  // },
  // {
  //   path: 'milkrun/trip-statuses',
  //   element: guarded([PERMISSION_CODE.MILKRUN_TRIP_STATUS_READ], <MilkrunTripCatalogPage key="trip-statuses" resourceName="trip-statuses" />),
  // },
  // {
  //   path: 'milkrun/vehicles',
  //   element: guarded([PERMISSION_CODE.MILKRUN_VEHICLE_READ], <MilkrunVehiclesPage />),
  // },
  { path: 'users', element: guarded([PERMISSION_CODE.ADMIN_USER_READ], <UsersPage />) },
  { path: 'roles', element: guarded([PERMISSION_CODE.ADMIN_ROLE_READ], <RolesPage />) },
  { path: '*', element: <Navigate to="/404" replace /> },
];

const createWorkspaceRoute = (role: RoleCode): RouteObject => ({
  element: <ProtectedRoute />,
  children: [{
    path: ROLE_WORKSPACES[role].basePath.slice(1),
    element: <WorkspaceLayout />,
    children: createFeatureRoutes(role),
  }],
});

export const workspaceRoutes: RouteObject[] = [
  ...ROLE_CODES.map(createWorkspaceRoute),
  {
    element: <ProtectedRoute />,
    children: [{
      path: 'workspace',
      element: <WorkspaceLayout />,
      children: createFeatureRoutes(),
    }],
  },
];
