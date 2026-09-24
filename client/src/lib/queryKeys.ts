type QueryParameters = Record<string, unknown>;

const resourceKeys = (resource: string) => ({
  all: [resource] as const,
  lists: [resource, 'list'] as const,
  list: (query: QueryParameters) => [resource, 'list', query] as const,
  lookups: [resource, 'lookup'] as const,
  lookup: (query: QueryParameters = {}) => [resource, 'lookup', query] as const,
  details: [resource, 'detail'] as const,
  detail: (id: string) => [resource, 'detail', id] as const,
});

export const queryKeys = {
  users: resourceKeys('users'),
  roles: resourceKeys('roles'),
  permissions: resourceKeys('permissions'),
  rolePermissions: {
    all: ['role-permissions'] as const,
    detail: (roleId: string) => ['role-permissions', roleId] as const,
  },
  userRoles: {
    all: ['user-roles'] as const,
    detail: (userId: string) => ['user-roles', userId] as const,
  },
  roleAreaTypeScopes: {
    all: ['role-area-type-scopes'] as const,
    detail: (roleId: string) => ['role-area-type-scopes', roleId] as const,
  },
  workShifts: resourceKeys('work-shifts'),
  userWorkShiftAssignments: resourceKeys('user-work-shift-assignments'),
  areas: resourceKeys('areas'),
  areaTypes: resourceKeys('area-types'),
  meAreaScopes: {
    all: ['me-area-scopes'] as const,
  },
  meStockAreaScopes: {
    all: ['me-stock-area-scopes'] as const,
  },
  supplyCategories: resourceKeys('supply-categories'),
  units: resourceKeys('units'),
  supplies: resourceKeys('supplies'),
  providers: resourceKeys('providers'),
  supplyProviders: {
    all: ['supply-providers'] as const,
    lists: ['supply-providers', 'list'] as const,
    list: (supplyId: string) => ['supply-providers', 'list', supplyId] as const,
  },
  supplyStackOptions: {
    all: ['supply-stack-options'] as const,
    list: (supplyId: string, providerId: string, areaId: string) => [
      'supply-stack-options',
      supplyId,
      providerId,
      areaId,
    ] as const,
  },
  supplyAvailability: {
    all: ['supply-availability'] as const,
    list: (supplyId: string, providerId: string, areaId: string) => [
      'supply-availability',
      supplyId,
      providerId,
      areaId,
    ] as const,
  },
  storageLocations: resourceKeys('storage-locations'),
  stockBalances: resourceKeys('stock-balances'),
  stockTransactions: resourceKeys('stock-transactions'),
  inventoryDiscrepancies: {
    all: ['inventory-discrepancies'] as const,
    balance: (stockBalanceId: string, query: QueryParameters = {}) => [
      'inventory-discrepancies',
      'stock-balance',
      stockBalanceId,
      query,
    ] as const,
    detail: (id: string) => ['inventory-discrepancies', 'detail', id] as const,
  },
  orders: resourceKeys('orders'),
  shiftOrderSheets: {
    ...resourceKeys('shift-order-sheets'),
    current: ['shift-order-sheets', 'current'] as const,
    histories: ['shift-order-sheets', 'history'] as const,
    history: (query: QueryParameters = {}) => ['shift-order-sheets', 'history', query] as const,
    incomings: ['shift-order-sheets', 'incoming'] as const,
    incoming: (query: QueryParameters = {}) => ['shift-order-sheets', 'incoming', query] as const,
  },
  notifications: resourceKeys('notifications'),
  orderStatuses: resourceKeys('order-statuses'),
  stockTransactionTypes: resourceKeys('stock-transaction-types'),
  adjustmentReasons: resourceKeys('adjustment-reasons'),
  allocationConfirmReasons: resourceKeys('allocation-confirm-reasons'),
  orderRevisionActions: resourceKeys('order-revision-actions'),
  milkrunTrips: resourceKeys('milkrun-trips'),
  milkrunRacks: resourceKeys('milkrun-racks'),
  milkrunShops: resourceKeys('milkrun-shops'),
  milkrunTripTypes: resourceKeys('milkrun-trip-types'),
  milkrunTripStatuses: resourceKeys('milkrun-trip-statuses'),
  milkrunVehicles: resourceKeys('milkrun-vehicles'),
  milkrunStockBalances: resourceKeys('milkrun-stock-balances'),
  milkrunStockTransactions: resourceKeys('milkrun-stock-transactions'),
  milkrunStockTransactionTypes: resourceKeys('milkrun-stock-transaction-types'),
  milkrunAdjustmentReasons: resourceKeys('milkrun-adjustment-reasons'),
  milkrunDashboard: {
    all: ['milkrun-dashboard'] as const,
    detail: (query: QueryParameters = {}) => ['milkrun-dashboard', query] as const,
  },
} as const;
