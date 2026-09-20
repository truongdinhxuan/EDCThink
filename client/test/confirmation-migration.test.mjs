import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const root = resolve(process.cwd(), 'src');
const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const walk = (directory) => readdirSync(directory).flatMap((name) => {
  const path = resolve(directory, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const productionSource = () => walk(root)
  .filter((path) => /\.(ts|tsx)$/.test(path))
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');

const supplyMasters = [
  'src/pages/catalog/SupplyCategoriesPage.tsx',
  'src/pages/catalog/ProvidersPage.tsx',
  'src/pages/catalog/StorageLocationsPage.tsx',
  'src/pages/catalog/SuppliesPage.tsx',
  'src/pages/management/AreasPage.tsx',
];

const adminResources = [
  'src/pages/management/UsersPage.tsx',
  'src/pages/management/RolesPage.tsx',
];

const milkrunMasters = [
  'src/pages/milkrun/RacksPage.tsx',
  'src/pages/milkrun/ShopsPage.tsx',
  'src/pages/milkrun/TripCatalogPage.tsx',
];

describe('Phase 4 confirmation migration contract', () => {
  it('removes unexplained legacy and browser-native confirmation surfaces', () => {
    const source = productionSource();
    assert.doesNotMatch(source, /\bConfirmDialog\b/);
    assert.doesNotMatch(source, /window\.confirm\s*\(/);
  });

  it('preserves Supply destructive actions alongside Phase 5 primary drawers', () => {
    for (const path of supplyMasters) {
      const source = read(path);
      assert.match(source, /useCrudOffcanvas\(\)/, path);
      assert.match(source, /openConfirm\(\{/, path);
      assert.match(source, /variant: 'warning'/, path);
      assert.match(source, /confirmLabel: 'Ngừng sử dụng'/, path);
      assert.match(source, /throwOnError: true/, path);
      assert.match(source, /\bPrimaryCrudDrawer\b/, path);
      assert.doesNotMatch(source, /\bConfirmDialog\b/, path);
    }
  });

  it('migrates Admin destructive actions while preserving form and permission ownership', () => {
    const users = read(adminResources[0]);
    const roles = read(adminResources[1]);
    for (const source of [users, roles]) {
      assert.match(source, /useCrudOffcanvas\(\)/);
      assert.match(source, /openConfirm\(\{/);
      assert.match(source, /hasPermission\(PERMISSION_CODE\./);
      assert.match(source, /\bPrimaryCrudDrawer\b/);
      assert.doesNotMatch(source, /\bConfirmDialog\b/);
    }
    assert.match(users, /ADMIN_USER_UPDATE/);
    assert.match(users, /confirmLabel: 'Ngừng sử dụng'/);
    assert.match(roles, /ADMIN_ROLE_UPDATE/);
    assert.match(roles, /variant: 'danger'/);
    // Wording is the team's to translate; what must hold is that the
    // destructive confirm still has its own label and danger variant.
    assert.match(roles, /confirmLabel: '[^']+'/);
  });

  it('migrates Milkrun master deactivation with resource-specific permissions intact', () => {
    for (const path of milkrunMasters) {
      const source = read(path);
      assert.match(source, /useCrudOffcanvas\(\)/, path);
      assert.match(source, /openConfirm\(\{/, path);
      assert.match(source, /variant: 'warning'/, path);
      assert.match(source, /throwOnError: true/, path);
      assert.match(source, /hasPermission\(/, path);
      assert.match(source, /\bPrimaryCrudDrawer\b/, path);
    }
    const shops = read(milkrunMasters[1]);
    const catalog = read(milkrunMasters[2]);
    assert.match(shops, /MILKRUN_SHOP_DEACTIVATE/);
    assert.match(catalog, /MILKRUN_TRIP_TYPE_DEACTIVATE/);
    assert.match(catalog, /MILKRUN_TRIP_STATUS_DEACTIVATE/);
  });

  it('uses a reason ConfirmOffcanvas for Order Reject with the exact payload', () => {
    const order = read('src/pages/orders/OrderDetailPage.tsx');
    assert.match(order, /title: 'Từ chối Order\?'/);
    assert.match(order, /variant: 'danger'/);
    assert.match(order, /Lý do từ chối là bắt buộc\./);
    assert.match(order, /rejectOrder\(id, \{ rejected_reason: rejectedReason \}\)/);
    assert.doesNotMatch(order, /panel === "reject"/);
  });

  it('requires a reason when cancelling the only cancellable PENDING state', () => {
    const order = read('src/pages/orders/OrderDetailPage.tsx');
    assert.match(order, /title: 'Hủy Order\?'/);
    assert.match(order, /status === "PENDING"/);
    assert.match(order, /Lý do hủy là bắt buộc\./);
    assert.match(order, /cancelOrder\(id, \{ cancel_reason: cancelReason \}\)/);
    assert.doesNotMatch(order, /panel === "cancel"/);
  });

  it('keeps Order status, allocation and issue business forms out of confirmation migration', () => {
    const order = read('src/pages/orders/OrderDetailPage.tsx');
    assert.match(order, /type ActionPanel = "approve" \| "issue" \| null/);
    assert.match(order, /actual_stack_quantity/);
    assert.match(order, /<CrudModal/);
    assert.match(order, /confirmApprove/);
    assert.match(order, /confirmIssue/);
  });

  it('migrates Trip Cancel only and retains permission/status ownership', () => {
    const trip = read('src/pages/milkrun/TripDetailPage.tsx');
    assert.match(trip, /title: 'Hủy Trip\?'/);
    assert.match(trip, /variant: 'danger'/);
    assert.match(trip, /cancelMilkrunTrip\(trip\.id, reasonRef\.current\?\.value\.trim\(\) \?\? ''\)/);
    assert.match(trip, /hasPermission\(PERMISSION_CODE\.MILKRUN_TRIP_CREATE\)/);
    assert.match(trip, /MILKRUN_TRIP_STATUS\.REGISTERED/);
    assert.match(trip, /MILKRUN_TRIP_STATUS\.STARTED/);
  });

  it('uses ConfirmOffcanvas only for the final Milkrun stock confirmation', () => {
    const stock = read('src/pages/milkrun/StockAdjustmentPage.tsx');
    assert.match(stock, /title: 'Xác nhận điều chỉnh tồn\?'/);
    assert.match(stock, /variant: 'danger'/);
    assert.match(stock, /createMilkrunStockAdjustment\(payload\)/);
    assert.match(stock, /queryKeys\.milkrunStockBalances\.all/);
    assert.match(stock, /queryKeys\.milkrunStockTransactions\.all/);
    assert.doesNotMatch(stock, /\bConfirmDialog\b/);
  });

  it('intentionally keeps Supply stock and discrepancy business input forms hybrid', () => {
    const balances = read('src/pages/stock/StockBalancesPage.tsx');
    const adjustment = read('src/components/stock/StockAdjustmentModal.tsx');
    assert.match(balances, /<StockAdjustmentModal/);
    assert.match(balances, /resolution_note/);
    assert.match(balances, /<CrudModal/);
    assert.match(adjustment, /<CrudModal/);
    assert.doesNotMatch(adjustment, /\bConfirmDialog\b/);
  });

  it('shows normalized backend failures inside the drawer and permits retry', () => {
    const confirmation = read('src/components/offcanvas/ConfirmOffcanvas.tsx');
    const resource = read('src/hooks/usePaginatedResource.ts');
    assert.match(confirmation, /catch \(confirmationError\)/);
    assert.match(confirmation, /role="alert"/);
    assert.match(confirmation, /setError\(null\)/);
    assert.match(resource, /throwOnError\?: boolean/);
    assert.match(resource, /throw new Error\(message, \{ cause: requestError \}\)/);
  });

  it('blocks duplicate actions and uses safe cancel initial focus', () => {
    const confirmation = read('src/components/offcanvas/ConfirmOffcanvas.tsx');
    const provider = read('src/components/offcanvas/OffcanvasProvider.tsx');
    assert.match(confirmation, /if \(busy \|\| pendingRef\.current\) return/);
    assert.match(confirmation, /preventCloseWhileBusy/);
    assert.match(confirmation, /data-confirm-cancel="true"/);
    assert.match(provider, /\[data-confirm-cancel="true"\]/);
    assert.match(provider, /requestCloseTop\('escape'\)/);
  });

  it('does not introduce role-name authorization, global cache clears, or reloads', () => {
    const sources = [...supplyMasters, ...adminResources, ...milkrunMasters,
      'src/pages/orders/OrderDetailPage.tsx',
      'src/pages/milkrun/TripDetailPage.tsx',
      'src/pages/milkrun/StockAdjustmentPage.tsx']
      .map(read)
      .join('\n');
    assert.doesNotMatch(sources, /(?:if\s*\(|\?|&&|\|\|)\s*role\s*===|role\.name\s*===|role\.includes\(|switch\s*\(\s*role/);
    assert.doesNotMatch(sources, /queryClient\.clear\(\)/);
    assert.doesNotMatch(sources, /window\.location\.reload\(|location\.reload\(/);
  });

  it('retains one primary plus one confirmation as the maximum drawer stack', () => {
    const provider = read('src/components/offcanvas/OffcanvasProvider.tsx');
    const types = read('src/types/offcanvas.types.ts');
    assert.match(types, /primary: CrudDrawerEntry \| null/);
    assert.match(types, /confirmation: ConfirmDrawerEntry \| null/);
    assert.match(provider, /warnStackLimit\(\)/);
    assert.doesNotMatch(types, /tertiary|thirdDrawer/);
  });
});
