import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

const loginPage = read('src/pages/auth/LoginPage.tsx');
const userForm = read('src/components/forms/UserForm.tsx');
const authService = read('src/api/auth.service.ts');
const createOrderForm = read('src/components/orders/CreateOrderForm.tsx');
const orderDetailPage = read('src/pages/orders/OrderDetailPage.tsx');
const stackFields = read('src/components/orders/OrderStackFields.tsx');
const adjustmentModal = read('src/components/stock/StockAdjustmentForm.tsx');

const TYPED_FILES = [
  'src/api/auth.service.ts',
  'src/types/inventory-discrepancies.ts',
  'src/types/milkrun.ts',
  'src/types/orders.ts',
  'src/types/stock-transactions.ts',
  'src/types/users.ts',
  'src/types/work-shifts.ts',
];

const QUANTITY_INPUT_FILES = [
  'src/components/orders/CreateOrderForm.tsx',
  'src/components/orders/OrderStackFields.tsx',
  'src/components/stock/StockAdjustmentForm.tsx',
  'src/pages/orders/OrderDetailPage.tsx',
];

describe('VinFast ID is a string on the client', () => {
  it('declares vinfast_id as string wherever it is typed', () => {
    for (const path of TYPED_FILES) {
      const source = read(path);
      const declarations = source.match(/vinfast_id\??:\s*[^;,\n]+/g) ?? [];
      assert.notEqual(declarations.length, 0, `${path} should still declare vinfast_id`);
      for (const declaration of declarations) {
        assert.match(declaration, /:\s*string/, `${path}: ${declaration}`);
        assert.doesNotMatch(declaration, /number/, `${path}: ${declaration}`);
      }
    }
  });

  it('logs in with a trimmed text field, not a numeric one', () => {
    assert.match(loginPage, /interface ILoginFormInput \{\s*vinfast_id: string;/);
    assert.match(loginPage, /vinfast_id: "",/);
    assert.match(loginPage, /type="text"/);
    assert.match(loginPage, /login\(\{ vinfast_id: vinfast_id\.trim\(\), password \}\)/);
    assert.doesNotMatch(loginPage, /valueAsNumber/);
    assert.doesNotMatch(authService, /vinfast_id: number/);
  });

  it('edits vinfast_id as text in the user form', () => {
    assert.match(userForm, /vinfast_id: user\?\.vinfast_id \?\? '',/);
    assert.match(userForm, /register\('vinfast_id'/);
    assert.doesNotMatch(userForm, /register\('vinfast_id',[^)]*valueAsNumber/);
  });
});

describe('Supply quantities are whole numbers on the client', () => {
  it('leaves no fractional step or floor on a quantity input', () => {
    for (const path of QUANTITY_INPUT_FILES) {
      const source = read(path);
      assert.doesNotMatch(source, /step="any"/, `${path} still allows fractions`);
      assert.doesNotMatch(source, /0\.000001/, `${path} still uses a fractional floor`);
    }
  });

  it('validates integers when creating an Order', () => {
    assert.match(createOrderForm, /min: \{ value: 1, message: 'Số lượng phải từ 1 trở lên\.' \}/);
    assert.match(
      createOrderForm,
      /validate: \(val\) => Number\.isInteger\(Number\(val\)\) \|\| 'Số lượng phải là số nguyên\.'/,
    );
    assert.match(createOrderForm, /step="1"/);
    assert.match(createOrderForm, /min="1"/);
    assert.match(stackFields, /step="1"/);
    assert.match(stackFields, /min="1"/);
  });

  it('validates integers when approving, issuing and confirming a stack count', () => {
    assert.match(orderDetailPage, /!Number\.isInteger\(approval\.quantity_approved\)/);
    assert.match(orderDetailPage, /Số lượng cấp phải là số nguyên\./);
    assert.match(orderDetailPage, /Number\.isInteger\(confirmActual\)/);
    assert.match(orderDetailPage, /Số chồng xác nhận phải là số nguyên/);
    assert.match(orderDetailPage, /!Number\.isInteger\(quantity\) \|\| quantity <= 0/);
  });

  it('validates integers when adjusting stock', () => {
    const validators = adjustmentModal.match(/validate: \(value\) => [^\n]+/g) ?? [];
    assert.equal(validators.length, 3);
    for (const validator of validators) {
      assert.match(validator, /Number\.isInteger\(value\) && value > 0/);
    }
  });

  it('formats quantities without a fractional part', () => {
    for (const path of [
      'src/components/orders/OrderItemAvailability.tsx',
      'src/components/orders/StockAvailabilityWarning.tsx',
      'src/pages/stock/StockBalancesPage.tsx',
      'src/pages/stock/StockTransactionsPage.tsx',
    ]) {
      const source = read(path);
      assert.match(source, /maximumFractionDigits: 0/, path);
    }
  });
});
