import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

const menu = read('src/components/common/ActionMenu.tsx');
const primitives = read('src/components/crud/CrudPrimitives.tsx');

const CRUD_PAGES = [
  'src/pages/catalog/ProvidersPage.tsx',
  'src/pages/catalog/StorageLocationsPage.tsx',
  'src/pages/catalog/SuppliesPage.tsx',
  'src/pages/catalog/SupplyCategoriesPage.tsx',
  'src/pages/catalog/UnitsPage.tsx',
  'src/pages/management/AreasPage.tsx',
  'src/pages/management/RolesPage.tsx',
  'src/pages/management/UsersPage.tsx',
];

describe('DataTable row actions are a dropdown', () => {
  it('renders one trigger that opens a menu instead of inline buttons', () => {
    assert.match(primitives, /return <ActionMenu items=\{items\}/);
    // The old inline row of Xem / Sửa / Deactivate buttons is gone.
    assert.doesNotMatch(primitives, /flex flex-wrap justify-end gap-x-3/);
    assert.doesNotMatch(primitives, /TextErrorButton/);
    assert.match(menu, /aria-haspopup="menu"/);
    assert.match(menu, /role="menu"/);
    assert.match(menu, /role="menuitem"/);
  });

  it('collapses every action behind a bare ellipsis trigger', () => {
    assert.match(menu, /faEllipsis/);
    assert.match(menu, /border-0 bg-transparent/);
    // No fill, no border, no shadow in the resting state.
    assert.doesNotMatch(menu, /TRIGGER_CLASS_NAME[\s\S]*?bg-gradient-to-b/);
    assert.doesNotMatch(menu, /TRIGGER_CLASS_NAME[\s\S]*?shadow-sm hover:shadow-md/);
    // An icon with no text has no accessible name unless one is supplied.
    assert.match(menu, /ariaLabel = 'Thao tác'/);
    assert.match(menu, /icon=\{faEllipsis\} aria-hidden="true"/);
    // Keyboard users still need to see where focus is.
    assert.match(menu, /focus-visible:ring-2/);
  });

  it('styles each tier from its own constant', () => {
    assert.match(primitives, /label: deleteLabel, onSelect: onDelete, danger: true/);
    // Page-specific, everyday, destructive. Wording of the classes is the
    // designer's; what must hold is that the three stay separate and that the
    // destructive one is the red one.
    assert.match(menu, /PRIMARY_ITEM_CLASS_NAME = '[^']+'/);
    assert.match(menu, /STANDARD_ITEM_CLASS_NAME = '[^']+'/);
    assert.match(menu, /DANGER_ITEM_CLASS_NAME = '[^']*text-red-[^']*'/);
  });

  it('separates the tiers, and only where there is something to separate', () => {
    assert.match(menu, /role="separator"/);
    assert.match(menu, /my-1 h-px bg-stone-200/);
    // Empty tiers drop out, so a menu never opens on a stray rule.
    assert.match(menu, /\.filter\(\(group\) => group\.length > 0\)/);
    assert.match(menu, /index > 0 && \(/);
  });

  it('portals the menu so the table cannot clip it', () => {
    // The table wrapper sets overflow-hidden and overflow-x-auto, so an
    // absolutely positioned menu would be cut off on the last rows.
    assert.match(menu, /createPortal\(/);
    assert.match(menu, /position: 'fixed'/);
    assert.match(menu, /APP_LAYER\.dropdown/);
    // Flips above the trigger when there is no room below.
    assert.match(menu, /fitsBelow/);
    assert.match(menu, /fitsAbove/);
  });

  it('hands the trigger, not the menu item, to callers for focus restore', () => {
    assert.match(menu, /onSelect: \(trigger: HTMLElement \| null\) => void/);
    assert.match(menu, /const trigger = triggerRef\.current;\s*\n\s*setOpen\(false\);/);
    for (const path of CRUD_PAGES) {
      const source = read(path);
      // A menu item is unmounted by the time the confirmation opens, so
      // event.currentTarget would be a detached node.
      assert.doesNotMatch(
        source,
        /triggerElement: event\.currentTarget/,
        `${path} still restores focus to a menu item`,
      );
    }
  });

  it('leaves no row action stranded outside the menu', () => {
    // Page-specific actions lead the menu; Xem/Sửa/Xóa follow.
    assert.match(primitives, /const items: ActionMenuItem\[\] = extraItems\.map\(/);
    // Pages list their extras; RowActions is what marks them as the lead tier.
    assert.match(primitives, /\{ \.\.\.item, primary: true \}/);
    const order = ['extraItems', "label: 'Xem'", "label: 'Sửa'", 'danger: true']
      .map((needle) => primitives.indexOf(needle));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), 'menu order drifted');
    const roles = read('src/pages/management/RolesPage.tsx');
    // Both used to sit beside the menu as bare buttons. Asserted by handler
    // rather than by label, which is wording the team is free to change.
    assert.match(roles, /extraItems=\{\[[\s\S]*?openPermissionMatrix\(item\)/);
    assert.match(roles, /extraItems=\{\[[\s\S]*?openAreaTypeScopes\(item\)/);
    assert.doesNotMatch(roles, /className=\{TextButton\}/);
    for (const path of CRUD_PAGES) {
      const source = read(path);
      if (!source.includes('<RowActions')) continue;
      // A row offering some actions in the menu and the rest next to it is the
      // inconsistency this whole change exists to remove.
      assert.doesNotMatch(
        source,
        /<div className="flex justify-end gap-2">/,
        `${path} still renders row actions beside the menu`,
      );
    }
  });

  it('opens the secondary Roles panels as off-canvas, like every other action', () => {
    const roles = read('src/pages/management/RolesPage.tsx');
    assert.doesNotMatch(roles, /<CrudModal/);
    assert.doesNotMatch(roles, /<FormActions/);
    const drawers = roles.match(/<PrimaryCrudDrawer/g) ?? [];
    // Role form, Permissions, Area Types.
    assert.equal(drawers.length, 3);
    // Titles are wording; what matters is each drawer names its own target.
    assert.match(roles, /title=\{`[^`]*\$\{permissionTarget\.name\}`\}/);
    assert.match(roles, /title=\{`[^`]*\$\{areaScopeTarget\.name\}`\}/);
    // Both save through the drawer footer, so unsaved work is guarded.
    assert.match(roles, /isDirty=\{!sameIds\(selectedPermissionIds, loadedPermissionIds\)\}/);
    assert.match(roles, /mode=\{canUpdate && !isSystemAdminTarget \? 'edit' : 'view'\}/);
  });

  it('closes on outside click and on Escape, returning focus to the trigger', () => {
    assert.match(menu, /mousedown', closeOnOutside/);
    assert.match(menu, /event\.key !== 'Escape'/);
    assert.match(menu, /triggerRef\.current\?\.focus\(\)/);
    assert.match(menu, /ArrowDown|ArrowUp/);
  });
});
