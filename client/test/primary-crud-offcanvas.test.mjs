import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const readManual = path => readFileSync(new URL(`manual/${path}`, import.meta.url), 'utf8');
const resources = [
  ['catalog/SupplyCategoriesPage', 'SupplyCategoryForm'],
  ['catalog/ProvidersPage', 'ProviderForm'],
  ['catalog/StorageLocationsPage', 'StorageLocationForm'],
  ['catalog/SuppliesPage', 'SupplyForm'],
  ['management/AreasPage', 'AreaForm'],
  ['management/UsersPage', 'UserForm'],
  ['management/RolesPage', 'RoleForm'],
  ['milkrun/RacksPage', 'RackForm'],
  ['milkrun/ShopsPage', 'ShopForm'],
  ['milkrun/TripCatalogPage', 'CatalogForm'],
];

// Source contracts complement, not replace, real-browser/local-API verification.
describe('Phase 5 Primary CRUD rollout source contracts', () => {
  for (const [page, form] of resources) {
    it(`${page}: one primary for create/view/edit, preserves list and confirmations`, () => {
      const source = read(`pages/${page}.tsx`);
      assert.match(source, /<PrimaryCrudDrawer mode=\{viewing \? 'view' : editing \? 'edit' : 'create'\}/);
      assert.match(source, /<CrudEntityView fields=/);
      assert.match(source, /onView=/);
      assert.match(source, /onEdit=\{viewing && canUpdate/);
      assert.match(source, /openConfirm\(/);
      assert.match(source, /usePaginatedResource/);
      assert.match(source, /resource\.runMutation/);
      assert.match(source, /error=\{formError\}/);
      assert.match(source, /setFormError\(error instanceof Error/);
      assert.doesNotMatch(source, /queryClient\.clear|location\.reload|navigate\(/);
      assert.doesNotMatch(source, /(?:if\s*\(|\?|&&|\|\|)\s*role\s*===|role\.name\s*===|role\.includes\(/);
      // RolesPage used to be the exception: its Permissions and Area Types
      // panels were centred modals. They are drawers now, so the rule is total.
      assert.doesNotMatch(source, /<CrudModal/);
    });
    it(`${form}: reusable RHF form retains dirty state and drawer footer`, () => {
      const source = read(`components/forms/${form}.tsx`);
      assert.match(source, /useForm</);
      assert.match(source, /defaultValues:/);
      assert.match(source, /isDirty/);
      assert.match(source, /<CrudDrawerForm isDirty=\{isDirty\}/);
      assert.match(source, /handleSubmit\(onSave\)/);
      assert.doesNotMatch(source, /<FormActions|<CrudModal|navigate\(|\breset\(/);
      assert.doesNotMatch(source, /from ['"].*api\//);
    });
  }
  it('adapter delegates stack/dirty/close semantics to the existing foundation', () => {
    const source = read('components/crud/PrimaryCrudDrawer.tsx');
    assert.match(source, /openCrud\(/);
    assert.match(source, /updatePrimary\(/);
    assert.match(source, /requestClosePrimary\('cancel'\)/);
    assert.match(source, /onBeforeClose: \(\) => !pendingRef\.current/);
    assert.match(source, /createPortal/);
    assert.match(source, /errorElement\.current\?\.scrollIntoView/);
    assert.doesNotMatch(source, /addEventListener|useBodyScrollLock|axios|useQuery/);
  });
  it('form shell blocks synchronous double-submit and clears busy in finally', () => {
    const source = read('components/crud/CrudDrawerForm.tsx');
    assert.match(source, /if \(submittingRef\.current \|\| busy \|\| submitDisabled\) return/);
    assert.match(source, /submittingRef\.current = true/);
    assert.match(source, /finally/);
    assert.match(source, /setPending\(false\)/);
    assert.match(source, /DrawerFormFooter formId=\{formId\}/);
    assert.match(source, /field\.dataset\.autofocus = 'true'/);
    assert.match(source, /fieldset disabled=\{busy\}/);
  });
  it('loads manual runtime URLs from project ENV instead of overriding frontend origin or API host', () => {
    const environment = readManual('project-test-environment.mjs');
    const verification = readManual('confirmation-verification.mjs');
    const localApi = readManual('confirmation-local-api.mjs');

    assert.match(environment, /requiredUrl\('ORIGIN_URL'\)/);
    assert.match(environment, /requiredUrl\('VITE_API_URL'\)/);
    assert.match(environment, /dotenv\.config\(/);
    assert.match(environment, /assertLoopbackUrl\(localSupabaseUrl/);
    assert.doesNotMatch(verification, /process\.env\.ORIGIN_URL\s*=|listen\(\{\s*host:\s*['"]127\.0\.0\.1/);
    assert.doesNotMatch(localApi, /process\.env\.ORIGIN_URL\s*=/);
  });
  it('preserves Supply relationships and stock-related payload fields', () => {
    const source = read('components/forms/SupplyForm.tsx');
    for (const field of ['provider_ids', 'category_id', 'unit_id', 'short_text', 'min_stock', 'max_stock', 'safety_stock']) assert.ok(source.includes(field));
    assert.match(source, /value\.length > 0/);
    assert.match(source, /<MultiSelect/);
  });
  it('preserves UNKNOW and system protections', () => {
    assert.match(read('components/forms/ProviderForm.tsx'), /disabled=\{isUnknown\}/);
    assert.match(read('components/forms/RoleForm.tsx'), /disabled=\{Boolean\(role\?\.is_system\)\}/);
    assert.match(read('components/forms/CatalogForm.tsx'), /readOnly=\{item\?\.is_system\}/);
  });
  it('User edit excludes passwords; work shifts are read-only in View', () => {
    const page = read('pages/management/UsersPage.tsx');
    assert.match(page, /createUser\(\{ \.\.\.commonInput, password: values\.password/);
    assert.match(page, /updateUser\(editing\.id, \{ \.\.\.commonInput, is_active:/);
    assert.match(page, /canAssign=\{!viewing && canUpdate\}/);
    assert.match(read('components/forms/UserForm.tsx'), /getValues\('password'\)/);
  });
  it('Vehicle assignment shares the primary; stock transaction detail is view-only', () => {
    const vehicle = read('pages/milkrun/VehiclesPage.tsx');
    const stock = read('pages/stock/StockTransactionsPage.tsx');
    assert.match(vehicle, /<PrimaryCrudDrawer mode=\{viewing \? 'view' : 'edit'\}/);
    assert.match(vehicle, /canAssign && canReadUsers/);
    assert.match(stock, /<PrimaryCrudDrawer mode="view"/);
    assert.match(stock, /queryKeys\.stockTransactions\.detail/);
    assert.doesNotMatch(stock, /updateStockTransaction|deleteStockTransaction/);
  });
});
