import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Phase 2 Units CRUD offcanvas contract', () => {
  it('migrates Units only from legacy centered dialogs to the shared offcanvas API', () => {
    const units = read('src/pages/catalog/UnitsPage.tsx');
    assert.match(units, /useCrudOffcanvas\(\)/);
    assert.match(units, /openCrud\(/);
    assert.match(units, /openConfirm\(/);
    assert.doesNotMatch(units, /\bCrudModal\b/);
    assert.doesNotMatch(units, /\bConfirmDialog\b/);
    assert.doesNotMatch(units, /navigate\(|window\.location|location\.reload/);
  });

  it('supports create, read-only view and edit through one typed primary drawer state', () => {
    const units = read('src/pages/catalog/UnitsPage.tsx');
    assert.match(units, /type UnitDrawerMode = Extract<CrudOffcanvasMode, 'create' \| 'view' \| 'edit'>/);
    assert.match(units, /openUnitDrawer\('create', null/);
    assert.match(units, /openUnitDrawer\('view', item/);
    assert.match(units, /openUnitDrawer\('edit', item/);
    assert.match(units, /<CrudEntityView/);
    assert.match(units, /switchViewToEdit/);
    assert.doesNotMatch(units, /openCrud\([\s\S]*?switchViewToEdit[\s\S]*?openCrud\(/);
  });

  it('keeps the Unit form independent from drawer internals and wires RHF dirty state', () => {
    const form = read('src/components/catalog/UnitForm.tsx');
    assert.doesNotMatch(form, /useCrudOffcanvas|OffcanvasProvider/);
    assert.match(form, /formState: \{ errors, isDirty \}/);
    assert.match(form, /onDirtyChange\(isDirty\)/);
    assert.match(form, /shouldFocusError: true/);
    assert.match(form, /data-autofocus="true"/);
    assert.match(form, /serverError &&/);
  });

  it('does not mark a fresh form dirty by normalizing an empty description on mount', () => {
    const form = read('src/components/catalog/UnitForm.tsx');
    assert.match(form, /description: item\?\.description \?\? ''/);
    assert.match(form, /setValueAs: \(value: string\) => value\.trim\(\)/);
    assert.match(form, /description: values\.description\?\.trim\(\) \|\| null/);
    assert.doesNotMatch(form, /setValueAs: \(value: string\) => value\.trim\(\) \|\| null/);
  });

  it('submits the form through the sticky footer and guards a rapid double submit', () => {
    const form = read('src/components/catalog/UnitForm.tsx');
    const units = read('src/pages/catalog/UnitsPage.tsx');
    const footer = read('src/components/offcanvas/DrawerFormFooter.tsx');
    assert.match(form, /if \(submittingRef\.current\)/);
    assert.match(form, /submittingRef\.current = true/);
    assert.match(units, /formId=\{current\.formId\}/);
    assert.match(units, /preventCloseWhileBusy: true/);
    assert.match(footer, /disabled=\{isSubmitting \|\| isDisabled\}/);
  });

  it('preserves form values on server failure and closes only after a successful mutation', () => {
    const units = read('src/pages/catalog/UnitsPage.tsx');
    assert.match(units, /const ok = await runMutation/);
    assert.match(units, /if \(ok\) \{[\s\S]*?closePrimary\(\)/);
    assert.match(units, /resource\.feedback\?\.type === 'error'/);
    assert.doesNotMatch(units, /reset\(/);
  });

  it('uses the exact success messages and invalidates only Unit list queries', () => {
    const units = read('src/pages/catalog/UnitsPage.tsx');
    assert.match(units, /mutationInvalidateQueryKey: queryKeys\.units\.lists/);
    assert.match(units, /Tạo đơn vị thành công\./);
    assert.match(units, /Cập nhật đơn vị thành công\./);
    assert.match(units, /Ngừng sử dụng đơn vị thành công\./);
    assert.doesNotMatch(units, /queryKeys\.supplies/);
    assert.doesNotMatch(units, /queryClient\.clear/);
  });

  it('keeps list query state in the page while the shared rail owns only filter presentation', () => {
    const units = read('src/pages/catalog/UnitsPage.tsx');
    assert.match(units, /usePaginatedResource<Unit, UnitQuery>/);
    assert.match(units, /<PageFilterRail/);
    assert.match(units, /value=\{search\}/);
    assert.match(units, /hideInternalSearch/);
    assert.match(units, /pagination=\{resource\.pagination\}/);
    assert.match(units, /sortBy=\{resource\.query\.sortBy\}/);
    assert.match(units, /updateResourceQuery\(\{ isActive: true \}\)/);
    assert.doesNotMatch(units, /\.slice\(/);
  });

  it('keeps a dirty primary form stable while the list query refetches', () => {
    const units = read('src/pages/catalog/UnitsPage.tsx');
    const form = read('src/components/catalog/UnitForm.tsx');
    assert.match(units, /item: Unit \| null/);
    assert.match(units, /key=\{current\.formKey\}/);
    assert.doesNotMatch(units, /resource\.items\.find/);
    assert.match(form, /defaultValues:/);
    assert.doesNotMatch(form, /reset\(/);
  });

  it('keeps permission visibility at the resource page and never authorizes by role name', () => {
    const units = read('src/pages/catalog/UnitsPage.tsx');
    assert.match(units, /SUPPLY_CATALOG_CREATE/);
    assert.match(units, /SUPPLY_CATALOG_UPDATE/);
    assert.match(units, /SUPPLY_CATALOG_DELETE/);
    assert.match(units, /onView=/);
    assert.doesNotMatch(units, /role\s*===|role\.includes|switch\s*\(\s*role/);
  });

  it('keeps deactivate confirmation open on backend failure', () => {
    const units = read('src/pages/catalog/UnitsPage.tsx');
    assert.match(units, /title: 'Ngừng sử dụng đơn vị\?'/);
    assert.match(units, /confirmLabel: 'Ngừng sử dụng'/);
    assert.match(units, /cancelLabel: 'Hủy'/);
    assert.match(units, /return ok \? undefined : false/);
    assert.match(units, /throwOnError: true/);
    // Focus returns to the row's action-menu trigger, which outlives the menu
    // item that was clicked.
    assert.match(units, /triggerElement: trigger/);
  });

  it('retains the legacy form modal but removes the unused centered confirmation', () => {
    const primitives = read('src/components/crud/CrudPrimitives.tsx');
    assert.match(primitives, /export const CrudModal/);
    assert.doesNotMatch(primitives, /export const ConfirmDialog/);
  });

  it('does not touch backend, routing, SSE or other resource invalidation from Units', () => {
    const units = read('src/pages/catalog/UnitsPage.tsx');
    assert.doesNotMatch(units, /useSupplyRealtime|notifications|milkrun|orders|supplies/);
    assert.doesNotMatch(units, /<Route|path=/);
  });
});
