import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Phase 3 shared Filter Rail contract', () => {
  it('T01/T09 lays out an inline desktop rail beside min-width-safe main content', () => {
    const rail = read('src/components/filters/PageFilterRail.tsx');
    assert.match(rail, /lg:flex-row lg:items-start/);
    // A fixed track on desktop, narrowed at lg so the data table keeps its
    // columns on a 1366px screen and widened again from xl.
    assert.match(rail, /lg:w-56 xl:w-60/);
    assert.match(rail, /lg:sticky lg:top-0/);
    assert.match(rail, /min-w-0 flex-1/);
    assert.match(rail, /overflow-y-auto overscroll-contain/);
  });

  it('T02/T03/T08 moves only Units search and active status into the rail', () => {
    const units = read('src/pages/catalog/UnitsPage.tsx');
    const railBlock = units.slice(units.indexOf('<PageFilterRail'), units.indexOf('</PageFilterRail>'));
    assert.match(railBlock, /FilterField label="Tìm kiếm"/);
    assert.match(railBlock, /FilterField label="Trạng thái"/);
    assert.match(railBlock, /value=\{search\}/);
    assert.match(railBlock, /value=\{String\(activeFilter \?\? true\)\}/);
    assert.doesNotMatch(railBlock, /CrudPageHeader|Thêm đơn vị|openUnitDrawer/);
    assert.match(units, /hideInternalSearch/);
  });

  it('T04/T05 keeps server query ownership, debounce and page-one reset convention', () => {
    const units = read('src/pages/catalog/UnitsPage.tsx');
    const hook = read('src/hooks/usePaginatedResource.ts');
    assert.match(units, /const debouncedSearch = useDebounce\(search, 400\)/);
    assert.match(units, /updateResourceQuery\(\{ search: nextSearch \}\)/);
    assert.match(units, /updateResourceQuery\(\{[\s\S]*?isActive: event\.target\.value === 'true'/);
    assert.match(hook, /const updateQuery = useCallback\(\(patch: Partial<Q>, resetPage = true\)/);
    assert.match(hook, /resetPage \? \{ page: 1 \} : \{\}/);
  });

  it('T06/T19 keeps business filter values outside open and collapse state', () => {
    const rail = read('src/components/filters/PageFilterRail.tsx');
    const provider = read('src/components/filters/FilterRailProvider.tsx');
    assert.match(rail, /const \[desktopCollapsed, setDesktopCollapsed\] = useState<boolean>\(readCollapsedPreference\)/);
    assert.match(rail, /FILTER_RAIL_COLLAPSED_KEY = 'filterRail\.collapsed'/);
    assert.doesNotMatch(rail, /useState<.*search|setSearch|updateQuery|queryClient/);
    assert.doesNotMatch(provider, /search|filterValue|queryClient|invalidateQueries/);
  });

  it('T07/T12 preserves right-side CRUD and closes the left filter when CRUD opens', () => {
    const workspace = read('src/layouts/workspace/WorkspaceLayout.tsx');
    const offcanvas = read('src/components/offcanvas/Offcanvas.tsx');
    const units = read('src/pages/catalog/UnitsPage.tsx');
    assert.match(workspace, /<OffcanvasProvider onDrawerOpen=\{\(\) => \{/);
    assert.match(workspace, /closeFilterRail\(undefined, false\)/);
    assert.match(offcanvas, /fixed inset-y-0 right-0/);
    assert.match(units, /openCrud\(/);
  });

  it('T10/T11 renders a separate left mobile drawer and coordinates it with Sidebar', () => {
    const rail = read('src/components/filters/PageFilterRail.tsx');
    const css = read('src/index.css');
    const workspace = read('src/layouts/workspace/WorkspaceLayout.tsx');
    const provider = read('src/components/filters/FilterRailProvider.tsx');
    assert.match(rail, /createPortal\(/);
    assert.match(rail, /fixed inset-y-0 left-0/);
    assert.match(css, /\.filter-rail-panel[\s\S]*?translate3d\(-100%, 0, 0\)/);
    assert.match(css, /\.filter-rail-panel\[data-open="true"\][\s\S]*?translate3d\(0, 0, 0\)/);
    assert.match(workspace, /if \(open\) closeFilterRail\(undefined, false\)/);
    assert.match(workspace, /FilterRailProvider onRailOpen=\{closeMobileSidebar\}/);
    assert.match(provider, /onRailOpen\?\.\(\)/);
  });

  it('T13/T14/T15 provides ESC, focus trap, return focus and body scroll lock', () => {
    const rail = read('src/components/filters/PageFilterRail.tsx');
    assert.match(rail, /event\.key === 'Escape'/);
    assert.match(rail, /trapTabKey\(event, panel\)/);
    assert.match(rail, /focusFirstElement\(mobilePanelRef\.current\)/);
    assert.match(rail, /restoreFocus\(triggerRef\.current\)/);
    assert.match(rail, /useBodyScrollLock\(mobileOpen/);
    assert.match(rail, /aria-modal="true"/);
    assert.match(rail, /aria-labelledby=\{titleId\}/);
  });

  it('T16 reduces filter transitions when reduced motion is requested', () => {
    const css = read('src/index.css');
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /\.filter-rail-backdrop/);
    assert.match(css, /\.filter-rail-panel/);
    assert.match(css, /transition-duration: 0\.01ms/);
  });

  it('T17/T18 centralizes global layer order for filter, dropdown, drawers, toast and tooltip', () => {
    const layers = read('src/constants/layers.ts');
    assert.match(layers, /navigation: 40/);
    assert.match(layers, /filterBackdrop: 50/);
    assert.match(layers, /filterDrawer: 51/);
    assert.match(layers, /dropdown: 70/);
    assert.match(layers, /primaryDrawer: 81/);
    assert.match(layers, /confirmationDrawer: 91/);
    assert.match(layers, /toast: 100/);
    assert.match(layers, /tooltip: 200/);

    for (const path of [
      'src/components/filters/PageFilterRail.tsx',
      'src/components/notifications/NotificationBell.tsx',
      'src/components/workspace/UserMenu.tsx',
      'src/components/common/MultiSelect.tsx',
      'src/components/notifications/LiveNotificationToast.tsx',
      'src/components/common/AppTooltip.tsx',
    ]) {
      assert.match(read(path), /APP_LAYER/);
    }
  });

  it('T20 preserves legacy DataTable search and toolbar while allowing opt-out', () => {
    const table = read('src/components/common/DataTable.tsx');
    assert.match(table, /hideInternalSearch\?: boolean/);
    assert.match(table, /hideInternalSearch = false/);
    assert.match(table, /Boolean\(onSearchChange\) && !hideInternalSearch/);
    assert.match(table, /renderTopToolbar\?\.\(\)/);
    assert.match(table, /pagination && onPageChange && onPageSizeChange/);
  });
});
