import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { PERMISSION_CODE, type PermissionCode } from '../../src/domain/permission-codes';
import {
  canReadSheetArea,
  isSheetAreaScoped,
  resolveIncomingAreaIds,
  resolveReadableAreaIds,
} from '../../src/domain/sheet-access';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

const service = read('src/services/shift-order-sheets.service.ts');
const routes = read('src/routes/supply/shift-order-sheets/index.ts');
const schemas = read('src/schemas/shift-order-sheets.ts');

const PACKING_AREAS = ['dg-hatinh', 'dg-india', 'dg-indo', 'vtdg'];

const actor = (
  areaId: string,
  permissions: PermissionCode[],
  isSystemAdmin = false,
) => ({ areaId, permissions, isSystemAdmin });

const creator = actor('dg-hatinh', [PERMISSION_CODE.SUPPLY_ORDER_CREATE]);
const issuer = actor('dg-hatinh', [PERMISSION_CODE.SUPPLY_ORDER_ISSUE]);
const approver = actor('vtdg', [PERMISSION_CODE.SUPPLY_ORDER_APPROVE]);
const admin = actor('vtdg', [], true);

describe('Shift Order Sheet Area isolation', () => {
  it('pins every actor without approval authority to their own Area', () => {
    assert.equal(isSheetAreaScoped(creator), true);
    assert.equal(isSheetAreaScoped(approver), false);
    assert.equal(isSheetAreaScoped(admin), false);

    assert.deepEqual(resolveReadableAreaIds(creator, PACKING_AREAS), ['dg-hatinh']);
    assert.deepEqual(resolveReadableAreaIds(approver, PACKING_AREAS), PACKING_AREAS);
  });

  it('pins a role that only holds issue or allocate, not just creators', () => {
    // The trap a pick-your-permissions model invites: a role built by ticking a
    // single order code must not become cross-Area readable by omission.
    assert.equal(isSheetAreaScoped(issuer), true);
    assert.deepEqual(resolveReadableAreaIds(issuer, PACKING_AREAS), ['dg-hatinh']);
  });

  it('keeps Area Type Scope as the ceiling, never widened by pinning', () => {
    // An Area outside the role's Area Type Scope stays unreadable even when it
    // is the actor's own Area.
    const outsider = actor('edc-logistics', [PERMISSION_CODE.SUPPLY_ORDER_CREATE]);
    assert.deepEqual(resolveReadableAreaIds(outsider, PACKING_AREAS), []);
    assert.equal(canReadSheetArea(outsider, PACKING_AREAS, 'edc-logistics'), false);
  });

  it('refuses a sibling market that merely shares the Area Type', () => {
    assert.equal(canReadSheetArea(creator, PACKING_AREAS, 'dg-hatinh'), true);
    assert.equal(canReadSheetArea(creator, PACKING_AREAS, 'dg-india'), false);
    assert.equal(canReadSheetArea(creator, PACKING_AREAS, 'dg-indo'), false);
    // The approver reviews every market in scope.
    assert.equal(canReadSheetArea(approver, PACKING_AREAS, 'dg-india'), true);
  });

  it('excludes the approver own supplying Area from the incoming market list', () => {
    assert.deepEqual(
      resolveIncomingAreaIds(approver, PACKING_AREAS),
      ['dg-hatinh', 'dg-india', 'dg-indo'],
    );
    // Without approval authority there is nothing incoming to review.
    assert.deepEqual(resolveIncomingAreaIds(creator, PACKING_AREAS), []);
  });

  it('applies the narrowed Area set to list, detail and export', () => {
    assert.match(service, /resolveReadableAreaIds\(/);
    assert.match(service, /request = request\.in\('area_id', readableAreaIds\)/);
    assert.match(service, /query\.areaId && !readableAreaIds\.includes\(query\.areaId\)/);
    assert.match(service, /canReadSheetArea\(actor, scopedAreaIds, row\.area_id\)/);
    // get() and export() both route through assertReadable.
    assert.equal((service.match(/await this\.assertReadable\(actor, row\)/g) ?? []).length, 2);
  });
});

describe('Incoming market Sheets for the approver', () => {
  it('narrows to one shift instance taken from the caller Sheet context', () => {
    assert.match(service, /async listIncoming\(/);
    assert.match(service, /\.eq\('work_date', query\.workDate\)/);
    assert.match(service, /\.eq\('work_shift_id', query\.workShiftId\)/);
    assert.match(service, /resolveIncomingAreaIds\(/);
    assert.match(schemas, /required: \['workDate', 'workShiftId'\]/);
  });

  it('counts what still needs a decision', () => {
    assert.match(service, /pending_order_count/);
    assert.match(service, /status_lookup\)\?\.code === 'PENDING'/);
  });

  it('requires approval authority and leaves Sheet read independent', () => {
    assert.match(
      routes,
      /'\/incoming'[\s\S]*?requirePermission\(PERMISSION_CODE\.SUPPLY_ORDER_APPROVE\)/,
    );
    // T14-T16: the Sheet read routes stay gated by their own permission and are
    // never widened by Order authority.
    assert.match(
      routes,
      /const readPermission[\s\S]*?requirePermission\(PERMISSION_CODE\.SUPPLY_SHIFT_ORDER_SHEET_READ\)/,
    );
    assert.doesNotMatch(routes, /ORDER_READ_PERMISSIONS|SUPPLY_ORDER_CREATE/);
  });
});
