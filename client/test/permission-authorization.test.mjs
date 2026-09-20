import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('frontend permission authorization contract', () => {
  it('exposes single, any and all permission helpers from auth state', () => {
    const authContext = read('src/context/AuthContext.tsx');
    assert.match(authContext, /hasPermission:/);
    assert.match(authContext, /hasAnyPermission:/);
    assert.match(authContext, /hasAllPermissions:/);
    assert.match(authContext, /user\?\.permissions \?\? \[\]/);
  });

  it('guards feature routes by permission instead of role', () => {
    const protectedRoute = read('src/components/ProtectedRoute.tsx');
    const workspaceRoutes = read('src/routes/workspace.routes.tsx');
    assert.doesNotMatch(protectedRoute, /allowedRoles|requiredRole|ROLE_CODE/);
    assert.match(workspaceRoutes, /PermissionGuard/);
    assert.doesNotMatch(workspaceRoutes, /allowedRoles|redirectRoleMismatchToHome/);
  });

  it('declares sidebar visibility with permission metadata', () => {
    const navigation = read('src/constants/workspaceNavigation.ts');
    assert.match(navigation, /permission: PERMISSION_CODE\.SUPPLY_CATALOG_READ/);
    assert.match(navigation, /anyPermissions:/);
    assert.doesNotMatch(navigation, /allowedRoles|roles:\s*\[/);
  });

  it('keeps catalog create, update and delete actions independently authorized', () => {
    const pages = [
      'AreasPage.tsx',
      'ProvidersPage.tsx',
      'StorageLocationsPage.tsx',
      'SuppliesPage.tsx',
      'SupplyCategoriesPage.tsx',
      'UnitsPage.tsx',
    ].map((file) => {
      const folder = file === 'AreasPage.tsx' ? 'management' : 'catalog';
      return read(`src/pages/${folder}/${file}`);
    }).join('\n');

    assert.match(pages, /SUPPLY_CATALOG_CREATE/);
    assert.match(pages, /SUPPLY_CATALOG_UPDATE/);
    assert.match(pages, /SUPPLY_CATALOG_DELETE/);
    assert.doesNotMatch(pages, /canMutate/);
  });

  it('uses dedicated Area CRUD permissions in navigation, route and actions', () => {
    const permissions = read('src/constants/permissions.ts');
    const navigation = read('src/constants/workspaceNavigation.ts');
    const routes = read('src/routes/workspace.routes.tsx');
    const page = read('src/pages/management/AreasPage.tsx');

    for (const permission of [
      'SUPPLY_AREA_READ',
      'SUPPLY_AREA_CREATE',
      'SUPPLY_AREA_UPDATE',
      'SUPPLY_AREA_DEACTIVATE',
    ]) assert.match(permissions, new RegExp(permission));

    assert.match(navigation, /path: 'areas'[\s\S]*?SUPPLY_AREA_READ/);
    assert.match(routes, /path: 'areas'[\s\S]*?SUPPLY_AREA_READ[\s\S]*?<AreasPage/);
    assert.match(page, /hasPermission\(PERMISSION_CODE\.SUPPLY_AREA_CREATE\)/);
    assert.match(page, /hasPermission\(PERMISSION_CODE\.SUPPLY_AREA_UPDATE\)/);
    assert.match(page, /hasPermission\(PERMISSION_CODE\.SUPPLY_AREA_DEACTIVATE\)/);
    assert.doesNotMatch(page, /hasPermission\(PERMISSION_CODE\.SUPPLY_CATALOG_/);
  });

  it('does not retain role authorization arrays', () => {
    const roles = read('src/constants/roles.ts');
    assert.doesNotMatch(roles, /ORDER_CREATOR_ROLES|STOCK_MUTATOR_ROLES|MASTER_DATA_MANAGER_ROLES/);
  });

  it('builds the four Phase 10 Aside catalogs entirely from permission metadata', () => {
    const navigation = read('src/constants/workspaceNavigation.ts');
    // Asserted by structure, not by wording: the labels are display text that
    // gets translated, and matching them as plain strings also matched the
    // commented-out legacy catalogs, which is a pass that proves nothing.
    const definition = navigation.slice(
      navigation.indexOf('const WORKSPACE_NAVIGATION'),
      navigation.indexOf('export const buildWorkspaceNavigation'),
    );
    const catalogs = definition.match(/^ {4}label: '[^']+',$/gm) ?? [];
    assert.equal(catalogs.length, 3, 'live top-level catalogs');

    for (const permission of [
      'MILKRUN_TRIP_CREATE',
      'MILKRUN_TRIP_READ_OWN',
      'MILKRUN_TRIP_READ_ALL',
      'MILKRUN_STOCK_READ',
      'MILKRUN_STOCK_ADJUST',
      'MILKRUN_RACK_READ',
      'MILKRUN_VEHICLE_READ',
      'MILKRUN_DASHBOARD_READ',
    ]) assert.match(navigation, new RegExp(`PERMISSION_CODE\\.${permission}`));

    assert.doesNotMatch(navigation, /role\s*===|role\.includes|allowedRoles/);
  });

  it('guards and loads the Milkrun dashboard through its dedicated permission', () => {
    const routes = read('src/routes/workspace.routes.tsx');
    const dashboardApi = read('src/api/milkrun-dashboard.service.ts');
    const dashboardPage = read('src/pages/milkrun/DashboardPage.tsx');
    assert.match(routes, /dashboard\/milkrun/);
    assert.match(routes, /MILKRUN_DASHBOARD_READ/);
    assert.match(dashboardApi, /milkrun\/dashboard/);
    assert.match(dashboardPage, /queryKeys\.milkrunDashboard/);
    assert.doesNotMatch(dashboardPage, /role\s*===|role\.includes/);
  });

  it('allows read-only Rack users to see and open the Rack page', () => {
    const navigation = read('src/constants/workspaceNavigation.ts');
    const routes = read('src/routes/workspace.routes.tsx');
    assert.match(
      navigation,
      /path: 'milkrun\/racks'[\s\S]*?permission: PERMISSION_CODE\.MILKRUN_RACK_READ/,
    );
    assert.match(
      routes,
      /path: 'milkrun\/racks'[\s\S]*?MILKRUN_RACK_READ/,
    );
  });

  it('uses the dedicated Shop read permission for navigation and route access', () => {
    const permissions = read('src/constants/permissions.ts');
    const navigation = read('src/constants/workspaceNavigation.ts');
    const routes = read('src/routes/workspace.routes.tsx');
    for (const permission of [
      'MILKRUN_SHOP_READ',
      'MILKRUN_SHOP_CREATE',
      'MILKRUN_SHOP_UPDATE',
      'MILKRUN_SHOP_DEACTIVATE',
    ]) assert.match(permissions, new RegExp(permission));
    assert.match(
      navigation,
      /path: 'milkrun\/shops'[\s\S]*?permission: PERMISSION_CODE\.MILKRUN_SHOP_READ/,
    );
    assert.match(
      routes,
      /path: 'milkrun\/shops'[\s\S]*?MILKRUN_SHOP_READ[\s\S]*?<MilkrunShopsPage/,
    );
  });

  it('uses dedicated Trip Type and Trip Status permissions for navigation and routes', () => {
    const permissions = read('src/constants/permissions.ts');
    const navigation = read('src/constants/workspaceNavigation.ts');
    const routes = read('src/routes/workspace.routes.tsx');
    for (const permission of [
      'MILKRUN_TRIP_TYPE_READ',
      'MILKRUN_TRIP_TYPE_CREATE',
      'MILKRUN_TRIP_TYPE_UPDATE',
      'MILKRUN_TRIP_TYPE_DEACTIVATE',
      'MILKRUN_TRIP_STATUS_READ',
      'MILKRUN_TRIP_STATUS_CREATE',
      'MILKRUN_TRIP_STATUS_UPDATE',
      'MILKRUN_TRIP_STATUS_DEACTIVATE',
    ]) assert.match(permissions, new RegExp(permission));
    assert.match(navigation, /milkrun\/trip-types'[\s\S]*?MILKRUN_TRIP_TYPE_READ/);
    assert.match(navigation, /milkrun\/trip-statuses'[\s\S]*?MILKRUN_TRIP_STATUS_READ/);
    assert.match(routes, /milkrun\/trip-types'[\s\S]*?MILKRUN_TRIP_TYPE_READ/);
    assert.match(routes, /milkrun\/trip-statuses'[\s\S]*?MILKRUN_TRIP_STATUS_READ/);
  });
});
