import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  DEFAULT_WORKSPACE_BASE_PATH,
  LEGACY_WORKSPACE_BASE_PATHS,
  getRoleBasePath,
  getRoleHomePath,
  getWorkspacePath,
  toWorkspacePathname,
} from '../src/constants/workspaces.ts';
import { resolveRoleCode } from '../src/constants/roles.ts';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

const workspaces = read('src/constants/workspaces.ts');
const roles = read('src/constants/roles.ts');
const routes = read('src/routes/workspace.routes.tsx');
const legacyRedirect = read('src/routes/LegacyRoleRedirect.tsx');
const dashboard = read('src/pages/dashboards/RoleDashboardPage.tsx');
const unauthorized = read('src/pages/error/UnauthorizedPage.tsx');

describe('workspace path helpers always resolve to /workspace', () => {
  it('exposes /workspace as the single base path', () => {
    assert.equal(DEFAULT_WORKSPACE_BASE_PATH, '/workspace');
  });

  it('ignores the role argument entirely', () => {
    for (const role of [null, undefined, 'ADMIN', 'DATA_PACKING', 'ANY_NEW_DB_ROLE']) {
      assert.equal(getRoleBasePath(role), '/workspace');
      assert.equal(getRoleHomePath(role), '/workspace/dashboard');
      assert.equal(getWorkspacePath(role, 'orders'), '/workspace/orders');
      assert.equal(getWorkspacePath(role, 'orders/create'), '/workspace/orders/create');
      assert.equal(getWorkspacePath(role), '/workspace');
      assert.equal(getWorkspacePath(role, '/orders'), '/workspace/orders');
    }
  });

  it('no longer keeps a role -> basePath configuration object', () => {
    assert.doesNotMatch(workspaces, /ROLE_WORKSPACES|dashboardLabel|dashboardDescription/);
    assert.doesNotMatch(workspaces, /'\/teamlead'\s*:|basePath:/);
  });
});

describe('legacy role-prefixed URLs rewrite onto /workspace', () => {
  it('covers every pre-RBAC prefix', () => {
    assert.deepEqual(
      [...LEGACY_WORKSPACE_BASE_PATHS],
      ['/admin', '/teamlead', '/datavt', '/datadg', '/material-control'],
    );
  });

  it('maps bare prefixes and deep sub-paths', () => {
    assert.equal(toWorkspacePathname('/admin'), '/workspace');
    assert.equal(toWorkspacePathname('/datadg/orders'), '/workspace/orders');
    assert.equal(toWorkspacePathname('/datavt/orders/42'), '/workspace/orders/42');
    assert.equal(toWorkspacePathname('/teamlead/shift-order-sheets'), '/workspace/shift-order-sheets');
    assert.equal(
      toWorkspacePathname('/material-control/stock-balances'),
      '/workspace/stock-balances',
    );
  });

  it('leaves non-legacy pathnames untouched', () => {
    for (const pathname of ['/workspace/orders', '/auth/login', '/404', '/', '/administration']) {
      assert.equal(toWorkspacePathname(pathname), pathname);
    }
  });

  it('preserves query string and hash and replaces history', () => {
    assert.match(legacyRedirect, /toWorkspacePathname\(pathname\)\}\$\{search\}\$\{hash\}/);
    assert.match(legacyRedirect, /<Navigate[\s\S]*replace\s*\/>/);
  });

  it('registers a redirect route for the bare prefix and the splat', () => {
    assert.match(routes, /path: segment, element: <LegacyRoleRedirect \/>/);
    assert.match(routes, /path: `\$\{segment\}\/\*`, element: <LegacyRoleRedirect \/>/);
    assert.match(routes, /LEGACY_WORKSPACE_BASE_PATHS\.flatMap/);
  });
});

describe('routes collapse to a single workspace branch', () => {
  it('drops the per-role route loop', () => {
    assert.doesNotMatch(routes, /ROLE_CODES\.map|createWorkspaceRoute|ROLE_WORKSPACES/);
  });

  it('mounts exactly one WorkspaceLayout branch at /workspace', () => {
    assert.match(routes, /path: DEFAULT_WORKSPACE_BASE_PATH\.slice\(1\)/);
    assert.equal((routes.match(/<WorkspaceLayout \/>/g) ?? []).length, 1);
    assert.equal((routes.match(/createFeatureRoutes\(\)/g) ?? []).length, 1);
  });

  it('keeps ProtectedRoute + PermissionGuard authorization untouched', () => {
    assert.match(routes, /<ProtectedRoute \/>/);
    assert.match(routes, /<PermissionGuard anyOf=\{permissions\}>/);
    assert.doesNotMatch(routes, /allowedRoles|requiredRole|role\s*===/);
  });

  it('still registers every feature route and the 404 fallback', () => {
    for (const path of [
      'dashboard', 'orders', 'orders/create', 'orders/:id',
      'shift-order-sheets', 'shift-order-sheets/:id',
      'supplies', 'providers', 'supply-categories', 'units', 'storage-locations',
      'areas', 'stock-balances', 'stock-transactions', 'users', 'roles',
    ]) assert.match(routes, new RegExp(`path: '${path.replace(/[/:]/g, '\\$&')}'`));
    assert.match(routes, /path: '\*', element: <Navigate to="\/404" replace \/>/);
  });
});

describe('roles are resolved dynamically from the database', () => {
  it('types RoleCode as a plain string', () => {
    assert.match(roles, /export type RoleCode = string;/);
  });

  it('accepts any non-empty role code, in any API shape', () => {
    assert.equal(resolveRoleCode('ADMIN'), 'ADMIN');
    assert.equal(resolveRoleCode('BRAND_NEW_ROLE'), 'BRAND_NEW_ROLE');
    assert.equal(resolveRoleCode({ code: 'WAREHOUSE_AUDITOR' }), 'WAREHOUSE_AUDITOR');
    assert.equal(resolveRoleCode([{ code: 'QA_LEAD' }]), 'QA_LEAD');
    assert.equal(resolveRoleCode('  PADDED  '), 'PADDED');
  });

  it('still rejects empty and unusable values', () => {
    for (const value of [null, undefined, '', '   ', {}, [], 42]) {
      assert.equal(resolveRoleCode(value), null);
    }
  });

  it('no longer gates resolution behind a hardcoded list', () => {
    assert.doesNotMatch(roles, /ROLE_CODES\.includes/);
  });
});

describe('UI reads role and permission wording dynamically', () => {
  it('dashboard renders the role name from the user record', () => {
    assert.match(dashboard, /profile\?\.role && typeof profile\.role === "object"/);
    assert.match(dashboard, /profile\.role\.name/);
    assert.doesNotMatch(dashboard, /ROLE_WORKSPACES|workspaceRole|dashboardLabel/);
  });

  it('403 page talks about permissions, not a fixed set of roles', () => {
    assert.match(unauthorized, /Bạn chưa được cấp quyền \(permission\) để truy cập chức năng này\./);
    assert.doesNotMatch(unauthorized, /năm role|một trong năm/);
  });
});
