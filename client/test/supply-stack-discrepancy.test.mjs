import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

const orderDetail = read('src/pages/orders/OrderDetailPage.tsx');
const balancePage = read('src/pages/stock/StockBalancesPage.tsx');
const transactionPage = read('src/pages/stock/StockTransactionsPage.tsx');
const orderService = read('src/api/orders.service.ts');
const balanceService = read('src/api/stock-balances.service.ts');
const discrepancyService = read('src/api/inventory-discrepancies.service.ts');
const queryKeys = read('src/lib/queryKeys.ts');
const permissions = read('src/constants/permissions.ts');
const transactionTypes = read('src/types/stock-transactions.ts');

describe('Supply stack Phase 5 frontend', () => {
  it('confirms one stack count per item, only with semantic permission', () => {
    assert.match(permissions, /supply\.order\.confirm_allocation/);
    assert.match(orderDetail, /SUPPLY_ORDER_CONFIRM_ALLOCATION/);
    assert.match(orderService, /orders\/\$\{orderId\}\/items\/\$\{orderItemId\}\/confirm/);
  });

  it('lets the count go above the approval, but a difference needs a reason', () => {
    // The old cap ("không được vượt số chồng dự kiến") is gone on purpose: the
    // receiving Area may agree to take more.
    assert.doesNotMatch(orderDetail, /không được vượt số chồng dự kiến/i);
    assert.match(orderDetail, /confirmActual < confirmTargetApproved \? 'LOWER' : 'HIGHER'/);
    // Reasons come from the lookup, filtered by their own direction column.
    assert.match(orderDetail, /reason\.direction === confirmDirection/);
    assert.match(orderDetail, /confirmDirection !== null && !selectedConfirmReason/);
    assert.doesNotMatch(orderDetail, /'NOT_AVAILABLE'|'NEGOTIATED_(LOWER|HIGHER)'/);
  });

  it('labels a recount by where it came from', () => {
    assert.match(orderDetail, /discrepancy\.source === 'ISSUE'/);
    assert.match(balancePage, /discrepancy\.source === 'ISSUE'/);
  });

  it('invalidates only affected Order, stock, ledger and stack-option caches', () => {
    assert.match(orderDetail, /queryKeys\.orders\.detail/);
    assert.match(orderDetail, /queryKeys\.stockBalances\.all/);
    assert.match(orderDetail, /queryKeys\.stockTransactions\.all/);
    assert.match(orderDetail, /queryKeys\.supplyStackOptions\.all/);
    assert.doesNotMatch(orderDetail, /queryClient\.clear\(\)/);
  });

  it('shows derived warning, server-side filter and discrepancy history', () => {
    assert.match(balancePage, /has_open_discrepancy/);
    assert.match(balancePage, /Cần kiểm kê/);
    assert.match(balancePage, /warning: event\.target\.value/);
    assert.match(balanceService, /stock-balances\/\$\{stockBalanceId\}\/discrepancies/);
    assert.match(queryKeys, /inventoryDiscrepancies/);
  });

  it('requires resolution note and permission before resolving', () => {
    assert.match(permissions, /supply\.discrepancy\.resolve/);
    assert.match(balancePage, /SUPPLY_DISCREPANCY_RESOLVE/);
    assert.match(balancePage, /resolutionNote\.trim\(\)/);
    assert.match(discrepancyService, /inventory-discrepancies\/\$\{id\}\/resolve/);
  });

  it('renders discrepancy correction as immutable transaction audit data only', () => {
    assert.match(transactionTypes, /DISCREPANCY_CORRECTION/);
    assert.match(transactionTypes, /inventory_discrepancy_id/);
    assert.match(transactionPage, /detail\.discrepancy/);
    assert.doesNotMatch(transactionPage, /editTransaction|deleteTransaction/);
  });

  it('uses readable Order and actor relations instead of UUID fallbacks', () => {
    assert.match(transactionPage, /item\.order\?\.code/);
    assert.match(transactionPage, /detail\.order\?\.code/);
    assert.doesNotMatch(transactionPage, /detail\.order_id \|\|/);
    assert.doesNotMatch(transactionPage, /: detail\.created_by/);
  });
});
