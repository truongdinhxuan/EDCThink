import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

const orderService = read('src/services/orders.service.ts');
const orderAccess = read('src/domain/order-access.ts');
const createOrderForm = read('../client/src/components/orders/CreateOrderForm.tsx');
const orderDetailPage = read('../client/src/pages/orders/OrderDetailPage.tsx');

describe('order source and receiving area flow', () => {
  it('resolves the active VTDG area as the order source without a hard-coded UUID', () => {
    // Defined once in the domain layer: the Sheet screen reads the same
    // constant to decide whether this Area may raise Orders at all.
    assert.match(orderAccess, /ORDER_SOURCE_AREA_CODE = 'VTDG'/);
    assert.match(orderService, /ORDER_SOURCE_AREA_CODE,/);
    assert.match(
      orderService,
      /\.from\('areas'\)[\s\S]*\.eq\('code', ORDER_SOURCE_AREA_CODE\)[\s\S]*\.eq\('is_active', true\)[\s\S]*\.eq\('is_deleted', false\)/,
    );
    assert.match(orderService, /from_area_id: sourceAreaId/);
  });

  it('uses the authenticated user area as the receiving area', () => {
    assert.match(orderService, /body\.to_area_id !== actor\.areaId/);
    assert.match(orderService, /to_area_id: actor\.areaId/);
    assert.match(createOrderForm, /receivingAreaId = user\?\.publicData\.area_id/);
    assert.match(createOrderForm, /to_area_id: receivingAreaId/);
  });

  it('scopes order creators without approval permission by the receiving area', () => {
    assert.match(orderService, /order\.to_area_id !== actor\.areaId/);
    assert.match(orderService, /isOrderAreaScoped\(actor\)/);
    assert.match(orderService, /request = request\.eq\('to_area_id', actor\.areaId\)/);
    // Deny by default: approval authority is the ONLY thing that lifts the
    // own-Area pin. Requiring SUPPLY_ORDER_CREATE here as well used to leave a
    // role holding just supply.order.issue (or .allocate) readable but
    // unpinned, so it saw every Area's Orders.
    assert.match(orderAccess, /!includesPermission\(access, PERMISSION_CODE\.SUPPLY_ORDER_APPROVE\)/);
    assert.doesNotMatch(
      orderAccess,
      /isOrderAreaScoped[\s\S]*?&&\s*includesPermission\(access, PERMISSION_CODE\.SUPPLY_ORDER_CREATE\)/,
    );
    assert.match(orderAccess, /order\.to_area_id === access\.areaId/);
    assert.match(
      orderDetailPage,
      /user\?\.publicData\.area_id === order\.to_area_id/,
    );
  });

  it('renders both order areas as fixed values in the create form', () => {
    assert.match(createOrderForm, /area\.code === ORDER_SOURCE_AREA_CODE/);
    assert.match(createOrderForm, /sourceArea\?\.code/);
    assert.match(createOrderForm, /receivingArea\?\.code/);
    assert.doesNotMatch(createOrderForm, /register\("to_area_id"/);
  });
});
