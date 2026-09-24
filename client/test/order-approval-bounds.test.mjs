import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const orderDetail = readFileSync(
  resolve(process.cwd(), 'src/pages/orders/OrderDetailPage.tsx'),
  'utf8',
);
const confirmApprove = orderDetail.slice(
  orderDetail.indexOf('const confirmApprove = () => {'),
  orderDetail.indexOf('const confirmIssue = () => {'),
);

describe('Order approval bounds', () => {
  it('no longer requires a positive count or caps it at the request', () => {
    assert.doesNotMatch(confirmApprove, /quantity_approved <= 0/);
    assert.doesNotMatch(confirmApprove, /quantity_requested/);
    assert.doesNotMatch(orderDetail, /không vượt số lượng yêu cầu/);
  });

  it('refuses only a negative or fractional count', () => {
    assert.match(
      confirmApprove,
      /!Number\.isInteger\(approval\.quantity_approved\) \|\| approval\.quantity_approved < 0/,
    );
  });

  it('caps the approval at source stock, summing lines of one code', () => {
    assert.match(confirmApprove, /approved > Number\(item\.available_quantity \?\? 0\)/);
    assert.match(confirmApprove, /`\$\{item\.supply_id\}:\$\{item\.provider_id\}:\$\{item\.set_per_qty \?\? 'normal'\}`/);
    assert.match(orderDetail, /max=\{Number\(item\.available_quantity \?\? 0\)\}/);
  });
});
