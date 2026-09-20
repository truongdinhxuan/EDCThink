import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

const navigation = read('src/constants/workspaceNavigation.ts');
const areaLookup = read('src/hooks/useAreaLookup.ts');
const routes = read('src/routes/workspace.routes.tsx');
const form = read('src/components/orders/CreateOrderForm.tsx');
const combobox = read('src/components/orders/SupplyCombobox.tsx');
const providerSelect = read('src/components/common/SupplyProviderSelect.tsx');
const stackFields = read('src/components/orders/OrderStackFields.tsx');
const workspace = read('src/components/orders/ShiftOrderSheetWorkspace.tsx');
const ordersList = read('src/pages/orders/OrdersListPage.tsx');
const footer = read('src/components/offcanvas/DrawerFormFooter.tsx');
const layers = read('src/constants/layers.ts');

describe('UX P0 — navigation priority', () => {
  it('UXP0-001/003: Phiếu order ca is the first operational transaction entry', () => {
    const shiftIdx = navigation.indexOf("path: 'shift-order-sheets'");
    const ordersIdx = navigation.indexOf("path: 'orders'");
    assert.ok(shiftIdx > 0 && ordersIdx > 0);
    assert.ok(shiftIdx < ordersIdx, 'Phiếu order ca must precede Orders');
  });

  it('UXP0-001: direct "Tạo order" is demoted from the sidebar', () => {
    assert.doesNotMatch(navigation, /path: 'orders\/create'/);
    assert.doesNotMatch(navigation, /'Tạo order'/);
  });

  it('UXP0-002: legacy create/list/detail routes stay registered', () => {
    assert.match(routes, /path: 'orders\/create'/);
    assert.match(routes, /path: 'orders'/);
    assert.match(routes, /path: 'orders\/:id'/);
    assert.match(routes, /path: 'shift-order-sheets'/);
  });

  it('UXP0-044: navigation stays permission-driven, no role-name checks', () => {
    assert.match(navigation, /permission: PERMISSION_CODE\.SUPPLY_SHIFT_ORDER_SHEET_READ/);
    assert.doesNotMatch(navigation, /role\s*===|role\.includes|allowedRoles|Đóng Gói/);
  });
});

describe('UX P0 — Create Order friction', () => {
  it('UXP0-006/007: context is one compact line, Area gửi/nhận are not inputs', () => {
    assert.doesNotMatch(form, /Area gửi\s*\n\s*<input/);
    assert.doesNotMatch(form, /readOnly/);
    assert.match(form, /Ca \{shiftLabel\(sheetContext\)\}/);
    assert.match(form, /khóa theo phiếu/);
  });

  it('UXP0-008: derived Unit is inline metadata, only a hidden field is registered', () => {
    assert.match(form, /\(\{unitLabel\}\)/);
    assert.match(form, /type="hidden" \{\.\.\.register\(`order_list\.\$\{index\}\.unit_id`/);
  });

  it('UXP0-009: optional Order note is collapsed and rendered after the material list', () => {
    const noteIdx = form.indexOf("register('note')");
    const listIdx = form.indexOf('fields.map(');
    assert.ok(listIdx > 0 && noteIdx > listIdx, 'note must come after the material list');
    assert.match(form, /<details/);
    assert.match(form, /Ghi chú Order \(không bắt buộc\)/);
  });

  it('UXP0-010/011: first material row is the first focusable control', () => {
    assert.match(form, /autoFocusFlag=\{index === 0\}/);
    assert.match(combobox, /data-autofocus=\{autoFocusFlag \? 'true' : undefined\}/);
  });

  it('UXP0-016/017: add-row control sits below the list and focuses the new Supply', () => {
    assert.match(form, /\+ Thêm mã vật tư/);
    assert.match(form, /fields\.length > previousFieldCount\.current/);
    assert.match(form, /supplyInputRefs\[nextIndex\]\?\.current\?\.focus\(\)/);
  });

  it('UXP0-018: removing an unsaved row is immediate (no ConfirmOffcanvas)', () => {
    assert.match(form, /onClick=\{\(\) => remove\(index\)\}/);
    assert.doesNotMatch(form, /openConfirm|ConfirmOffcanvas/);
  });

  it('UXP0-023: disabled-submit reason is a single concise line', () => {
    assert.match(form, /Chọn mã vật tư và nhập số lượng để gửi Order\./);
  });
});

describe('UX P0 — focus + keyboard flow', () => {
  it('UXP0-012/013/014: provider resolution advances focus by provider count', () => {
    assert.match(providerSelect, /onResolve\?\:/);
    assert.match(providerSelect, /providerCount: providers\.length/);
    assert.match(form, /handleProviderResolve/);
    assert.match(form, /providerCount > 1 && providerSelectRefs\[index\]\?\.current/);
    assert.match(form, /setFocus\(`order_list\.\$\{index\}\.quantity_requested`\)/);
  });

  it('UXP0-015: availability hint never resets Supply or quantity', () => {
    const availability = read('src/components/orders/OrderItemAvailability.tsx');
    assert.doesNotMatch(availability, /setValue|onChange/);
  });

  it('UXP0-020/021: combobox keyboard contract preserved, Ctrl/Cmd+Enter submits', () => {
    assert.match(combobox, /event\.key === 'Enter' && open/);
    assert.match(combobox, /ArrowDown.*ArrowUp|ArrowDown' \|\| event\.key === 'ArrowUp'/s);
    assert.match(form, /event\.ctrlKey \|\| event\.metaKey/);
    assert.match(form, /if \(tag === 'INPUT'\) event\.preventDefault\(\)/);
  });

  it('UXP0-022: submit shortcut is communicated near the CTA', () => {
    assert.match(footer, /hint\?: ReactNode|hint\?:/);
    assert.match(workspace, /Ctrl \+ Enter để gửi Order/);
  });
});

describe('UX P0 — Shift Sheet workspace', () => {
  it('UXP0-004/027: a compact sticky bar keeps context + Thêm Order reachable', () => {
    assert.match(workspace, /sticky top-0 z-20/);
    assert.match(workspace, /compactContext/);
    assert.match(workspace, /Ca \$\{shiftLabel\(context\)\} · \$\{formatDate\(context\.work_date\)\}/);
  });

  it('UXP0-024/029/030: denser rows, no UUID columns, sticky header + first column', () => {
    assert.doesNotMatch(workspace, /min-w-\[1100px\]/);
    assert.match(workspace, /px-3 py-2\.5/);
    assert.match(workspace, /sticky top-0 z-10 bg-slate-50/);
    assert.match(workspace, /sticky left-0/);
  });

  it('UXP0-025: low-priority columns fold below lg/xl', () => {
    assert.match(workspace, /hidden px-3 py-2 xl:table-cell">Provider/);
    assert.match(workspace, /hidden px-3 py-2 xl:table-cell">Người tạo/);
    assert.match(workspace, /lg:table-cell">Thời gian/);
  });

  it('UXP0-026: mobile renders a dense stacked list, not the wide table', () => {
    assert.match(workspace, /md:hidden/);
    assert.match(workspace, /hidden max-h-\[65vh\] overflow-auto overscroll-contain md:block/);
  });

  it('UXP0-039/043: submit returns to the same mounted Sheet, identity preserved', () => {
    assert.match(workspace, /closePrimary\(\)/);
    assert.doesNotMatch(workspace, /navigate\(|window\.location/);
  });
});

describe('UX P0 — combobox dropdown + Orders filters', () => {
  it('UXP0-031: Supply dropdown is portaled above the drawer footer, below confirm', () => {
    assert.match(layers, /primaryDrawerPopover: 85/);
    assert.match(combobox, /createPortal\(/);
    assert.match(combobox, /position.*fixed|className="fixed/);
    assert.match(combobox, /APP_LAYER\.primaryDrawerPopover/);
  });

  it('UXP0-029/030: operator Orders filters expose readable Area, no raw UUID inputs', () => {
    assert.doesNotMatch(ordersList, /Created by UUID|Area UUID/);
    // Areas come from the API through the shared hook, never hardcoded.
    assert.match(ordersList, /useAreaLookup\(\)/);
    assert.match(areaLookup, /listAreas/);
    assert.match(ordersList, /\{area\.code\} — \{area\.name\}/);
    assert.match(ordersList, /value=\{resource\.query\.areaId \?\? ''\}/);
  });

  it('UXP0-042: stack fields keep set_per_qty select interactive, total is static text', () => {
    assert.match(stackFields, /ref=\{setPerQtySelectRef\}/);
    assert.match(stackFields, /Tổng SET\s*\n\s*<p/);
  });
});
