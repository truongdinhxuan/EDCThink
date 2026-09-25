import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  ORDER_STATUS_UPDATE_EXPIRED_MESSAGE,
  ORDER_STATUS_UPDATE_GRACE_MS,
  isOrderStatusUpdateExpired,
  resolveShiftEndAt,
} from '../../src/domain/orderRules';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');
const orderService = read('src/services/orders.service.ts');

/** Asia/Ho_Chi_Minh is a fixed UTC+7 with no DST, so +07:00 is exact all year. */
const vn = (value: string) => new Date(`${value}+07:00`);

const dayShift = { end_time: '14:00:00', crosses_midnight: false };
const nightShift = { end_time: '06:00:00', crosses_midnight: true };

describe('Order status update window', () => {
  it('closes three hours after a day shift ends', () => {
    assert.equal(ORDER_STATUS_UPDATE_GRACE_MS, 3 * 60 * 60 * 1000);
    // Ca 1 on 2026-09-15 ends 14:00; the window closes at 17:00.
    const cases: Array<[string, boolean]> = [
      ['2026-09-15T13:00:00', false],
      ['2026-09-15T14:00:00', false], // inside the grace period, not expired
      ['2026-09-15T16:59:59', false],
      ['2026-09-15T17:00:00', false], // boundary is exclusive: > cutoff
      ['2026-09-15T17:00:01', true],
      ['2026-09-16T09:00:00', true],
    ];
    for (const [at, expected] of cases) {
      assert.equal(
        isOrderStatusUpdateExpired('2026-09-15', dayShift, vn(at)),
        expected,
        `expected ${at} expired=${expected}`,
      );
    }
  });

  it('carries a night shift onto the next day before adding the grace period', () => {
    // Ca 3 raised on 2026-09-15 runs 22:00 -> 06:00 on the 16th, so the window
    // closes at 09:00 on the 16th, not at 09:00 on the 15th.
    assert.equal(
      resolveShiftEndAt('2026-09-15', nightShift)?.toISOString(),
      vn('2026-09-16T06:00:00').toISOString(),
    );
    assert.equal(isOrderStatusUpdateExpired('2026-09-15', nightShift, vn('2026-09-15T23:00:00')), false);
    assert.equal(isOrderStatusUpdateExpired('2026-09-15', nightShift, vn('2026-09-16T05:00:00')), false);
    assert.equal(isOrderStatusUpdateExpired('2026-09-15', nightShift, vn('2026-09-16T08:59:00')), false);
    assert.equal(isOrderStatusUpdateExpired('2026-09-15', nightShift, vn('2026-09-16T09:01:00')), true);
  });

  it('does not depend on the machine timezone', () => {
    // The same instant written in UTC must give the same verdict.
    assert.equal(
      isOrderStatusUpdateExpired('2026-09-15', dayShift, new Date('2026-09-15T09:59:00Z')),
      false, // 16:59 in Vietnam
    );
    assert.equal(
      isOrderStatusUpdateExpired('2026-09-15', dayShift, new Date('2026-09-15T10:01:00Z')),
      true, // 17:01 in Vietnam
    );
  });

  it('never strands an Order behind unreadable shift data', () => {
    // Bad master data must not leave an Order that nobody can approve, reject or
    // cancel; the status machine and permissions still apply.
    assert.equal(resolveShiftEndAt('not-a-date', dayShift), null);
    assert.equal(isOrderStatusUpdateExpired('not-a-date', dayShift, vn('2030-01-01T00:00:00')), false);
    assert.equal(
      isOrderStatusUpdateExpired('2026-09-15', { end_time: '' }, vn('2030-01-01T00:00:00')),
      false,
    );
  });

  it('refuses with 403 and a stable error code', () => {
    assert.match(
      orderService,
      /serviceError\(\s*403,\s*ORDER_STATUS_UPDATE_EXPIRED_MESSAGE,\s*undefined,\s*'ORDER_STATUS_UPDATE_WINDOW_EXPIRED',/,
    );
    assert.match(
      ORDER_STATUS_UPDATE_EXPIRED_MESSAGE,
      /kết thúc ca \+ 3 giờ/,
    );
  });

  it('guards every status transition, not just the approval ones', () => {
    // A gap in any one of these would let a stale Order be moved along.
    const methods = [
      'patch', 'approve', 'reject', 'confirmStackItem',
      'issue', 'receive', 'complete', 'cancel',
    ];
    for (const method of methods) {
      const body = orderService.slice(orderService.indexOf(`async ${method}(`));
      const nextMethod = body.slice(1).search(/\n  (?:private )?async \w+\(/);
      const scope = nextMethod === -1 ? body : body.slice(0, nextMethod);
      assert.match(
        scope,
        /this\.assertWithinStatusUpdateWindow\(/,
        `${method}() must assert the status update window`,
      );
    }
  });

  it('reuses the Sheet already loaded instead of re-deriving the shift', () => {
    assert.match(orderService, /private assertWithinStatusUpdateWindow\(order: OrderData\): void/);
    assert.match(orderService, /order\.shift_order_sheet/);
    // An Order with no Sheet has no shift to age against.
    assert.match(orderService, /if \(!workDate \|\| !endTime\) return;/);
  });
});
