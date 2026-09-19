import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

const modal = read('src/components/stock/StockAdjustmentModal.tsx');
const transactionTypes = read('src/types/stock-transactions.ts');
const balanceTypes = read('src/types/stock-balances.ts');
const transactionPage = read('src/pages/stock/StockTransactionsPage.tsx');
const balancePage = read('src/pages/stock/StockBalancesPage.tsx');

describe('Supply stack Phase 2 frontend', () => {
  it('uses Supply category only for presentation and enables stack form for IMPORT', () => {
    assert.match(modal, /selectedSupply\?\.category\?\.code === 'KIEN_SAT_TC'/);
    assert.match(modal, /selectedType === 'IMPORT'/);
    assert.match(modal, /Số chồng/);
    assert.match(modal, /SET \/ chồng/);
    assert.match(modal, /Tổng SET/);
  });

  it('calculates a preview, submits consistent quantity and resets stale values', () => {
    assert.match(modal, /stackQuantity \* setPerQty/);
    assert.match(modal, /payload\.quantity = values\.stack_quantity! \* values\.set_per_qty!/);
    assert.match(modal, /delete payload\.stack_quantity/);
    assert.match(modal, /delete payload\.set_per_qty/);
    assert.match(modal, /setValue\('stack_quantity', undefined/);
    assert.match(modal, /setValue\('set_per_qty', undefined/);
  });

  it('keeps dynamic positive numeric inputs instead of a fixed stack-size dropdown', () => {
    assert.match(modal, /register\('set_per_qty'/);
    assert.match(modal, /type="number"/);
    // Stack sizes stay free-form, but supply is counted in whole units only.
    assert.match(modal, /step="1"/);
    assert.doesNotMatch(modal, /step="any"/);
    assert.doesNotMatch(modal, /\[8,\s*9,\s*10,\s*11\]/);
  });

  it('models and displays balance and immutable-ledger stack metadata', () => {
    for (const field of ['set_per_qty', 'stack_quantity', 'before_stack_quantity', 'after_stack_quantity']) {
      assert.match(transactionTypes, new RegExp(field));
    }
    for (const field of ['set_per_qty', 'stack_quantity', 'total_set_quantity']) {
      assert.match(balanceTypes, new RegExp(field));
    }
    assert.match(balancePage, /SET \/ chồng/);
    assert.match(balancePage, /Số chồng/);
    assert.match(balancePage, /Tồn \/ Tổng SET/);
    assert.match(balancePage, /Chưa có dữ liệu quy cách chồng/);
    assert.match(transactionPage, /Số chồng trước/);
    assert.doesNotMatch(transactionPage, /updateStockTransaction|deleteStockTransaction/);
  });

  it('keeps unsupported manual Stack adjustment deferred with readable UX', () => {
    assert.match(modal, /isUnsupportedStackAdjustment/);
    assert.match(modal, /Loại điều chỉnh này hiện chưa hỗ trợ cho kiện sắt tiêu chuẩn/);
    assert.doesNotMatch(modal, /workaround|ADJUSTMENT_IN.*IMPORT/);
  });
});
