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
    assert.match(orderService, /ORDER_SOURCE_AREA_CODE = 'VTDG'/);
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
    assert.match(orderAccess, /includesPermission\(access, PERMISSION_CODE\.SUPPLY_ORDER_CREATE\)/);
    assert.match(orderAccess, /!includesPermission\(access, PERMISSION_CODE\.SUPPLY_ORDER_APPROVE\)/);
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
