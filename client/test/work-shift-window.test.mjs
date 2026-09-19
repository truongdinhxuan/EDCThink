import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { isOutsideShiftWindow } from '../src/utils/workShiftWindow.ts';
import { getApiErrorMessage } from '../src/api/errors.ts';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

const workspace = read('src/components/orders/ShiftOrderSheetWorkspace.tsx');
const page = read('src/pages/orders/ShiftOrderSheetsPage.tsx');

/** Asia/Ho_Chi_Minh is a fixed UTC+7 with no DST, so +07:00 is exact all year. */
const vn = (value) => Date.parse(`${value}+07:00`);

describe('work shift window', () => {
  // Ca 1: 06:00 -> 14:00 on 2026-09-15, does not cross midnight.
  const dayStart = '2026-09-15T06:00:00';
  const dayEnd = '2026-09-15T14:00:00';

  it('accepts the whole shift and rejects either side of it', () => {
    assert.equal(isOutsideShiftWindow(dayStart, dayEnd, vn('2026-09-15T05:59:59')), true);
    assert.equal(isOutsideShiftWindow(dayStart, dayEnd, vn('2026-09-15T06:00:00')), false);
    assert.equal(isOutsideShiftWindow(dayStart, dayEnd, vn('2026-09-15T10:30:00')), false);
    assert.equal(isOutsideShiftWindow(dayStart, dayEnd, vn('2026-09-15T13:59:59')), false);
    // Exclusive upper bound, matching `p_at >= end` in Postgres.
    assert.equal(isOutsideShiftWindow(dayStart, dayEnd, vn('2026-09-15T14:00:00')), true);
  });

  it('follows a night shift across midnight onto the next day', () => {
    // Ca 3: 22:00 -> 06:00, crosses_midnight, so the server already moved the
    // end bound to 2026-09-16.
    const nightStart = '2026-09-15T22:00:00';
    const nightEnd = '2026-09-16T06:00:00';

    assert.equal(isOutsideShiftWindow(nightStart, nightEnd, vn('2026-09-15T21:59:00')), true);
    assert.equal(isOutsideShiftWindow(nightStart, nightEnd, vn('2026-09-15T23:30:00')), false);
    // Past midnight but still the same shift instance.
    assert.equal(isOutsideShiftWindow(nightStart, nightEnd, vn('2026-09-16T00:30:00')), false);
    assert.equal(isOutsideShiftWindow(nightStart, nightEnd, vn('2026-09-16T05:59:00')), false);
    assert.equal(isOutsideShiftWindow(nightStart, nightEnd, vn('2026-09-16T06:00:00')), true);
  });

  it('does not depend on the machine timezone', () => {
    // The bounds carry their own offset, so an identical instant expressed in
    // UTC must produce the identical verdict.
    const insideUtc = Date.parse('2026-09-15T03:30:00Z'); // 10:30 in Vietnam
    assert.equal(isOutsideShiftWindow(dayStart, dayEnd, insideUtc), false);
    const outsideUtc = Date.parse('2026-09-15T07:00:00Z'); // 14:00 in Vietnam
    assert.equal(isOutsideShiftWindow(dayStart, dayEnd, outsideUtc), true);
  });

  it('never locks a Sheet whose window it cannot read', () => {
    const at = vn('2026-09-15T10:00:00');
    assert.equal(isOutsideShiftWindow(undefined, dayEnd, at), false);
    assert.equal(isOutsideShiftWindow(dayStart, undefined, at), false);
    assert.equal(isOutsideShiftWindow(null, null, at), false);
    assert.equal(isOutsideShiftWindow('not-a-date', dayEnd, at), false);
  });
});

describe('outside-hours lock in the Sheet workspace', () => {
  it('carries the server-computed window through to the workspace', () => {
    assert.match(page, /shift_start_at: context\.shift_start_at/);
    assert.match(page, /shift_end_at: context\.shift_end_at/);
    assert.match(page, /is_outside_working_hours: context\.is_outside_working_hours/);
  });

  it('hides "+ Thêm Order" outside the shift window', () => {
    assert.match(
      workspace,
      /const allowCreate = mode === 'current' && canCreateOrder && !isOutsideWorkingHours/,
    );
  });

  it('only locks the Sheet being worked, never a historical one', () => {
    assert.match(workspace, /const isOutsideWorkingHours = mode === 'current' &&/);
  });

  it('re-derives the verdict as time passes instead of trusting one snapshot', () => {
    assert.match(workspace, /window\.setInterval\(\(\) => setNow\(Date\.now\(\)\)/);
    assert.match(workspace, /window\.clearInterval\(ticker\)/);
    assert.match(workspace, /isOutsideShiftWindow\(context\.shift_start_at, context\.shift_end_at, now\)/);
  });

  it('blurs the list only, leaving both headers legible', () => {
    assert.match(
      workspace,
      /\{isOutsideWorkingHours && \([\s\S]*?absolute inset-0 z-10[\s\S]*?backdrop-blur-\[2px\]/,
    );
    assert.match(workspace, /Ngoài giờ làm việc, không thể thêm order/);
    // The page header and the card heading both sit outside the relative wrapper.
    const header = workspace.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '';
    assert.doesNotMatch(header, /isOutsideWorkingHours/);
    assert.match(
      workspace,
      /Các mã đang Order<\/h2>[\s\S]*?<div className="relative">/,
    );
  });
});

describe('backend refusal reaches the operator verbatim', () => {
  const axiosError = (status, body) => ({
    isAxiosError: true,
    message: `Request failed with status code ${status}`,
    response: { status, data: body },
  });

  it('surfaces the shift-window refusal instead of a generic fallback', () => {
    const backendMessage = 'Không thể tạo Order do đã ngoài thời gian quy định của ca làm việc.';
    assert.equal(
      getApiErrorMessage(axiosError(403, { error: backendMessage }), 'Không thể tạo và gửi Order.'),
      backendMessage,
    );
  });

  it('still falls back when the server leaks a technical string', () => {
    assert.equal(
      getApiErrorMessage(
        axiosError(500, { error: 'SQLSTATE 23505 duplicate key value' }),
        'Không thể tạo và gửi Order.',
      ),
      'Không thể tạo và gửi Order.',
    );
  });
});
