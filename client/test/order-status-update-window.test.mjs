import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  ORDER_STATUS_UPDATE_GRACE_MS,
  resolveShiftEndAt,
  resolveStatusUpdateCutoff,
} from '../src/utils/workShiftWindow.ts';
import { getApiErrorMessage, ORDER_STATUS_UPDATE_WINDOW_EXPIRED } from '../src/api/errors.ts';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

const page = read('src/pages/orders/OrderDetailPage.tsx');
const deadlineHook = read('src/hooks/useDeadlinePassed.ts');

/** Asia/Ho_Chi_Minh is a fixed UTC+7 with no DST, so +07:00 is exact all year. */
const vn = (value) => Date.parse(`${value}+07:00`);

const dayShift = { end_time: '14:00:00', crosses_midnight: false };
const nightShift = { end_time: '06:00:00', crosses_midnight: true };

describe('status update cutoff on the client', () => {
  it('agrees with the server: shift end plus three hours', () => {
    assert.equal(ORDER_STATUS_UPDATE_GRACE_MS, 3 * 60 * 60 * 1000);
    assert.equal(
      resolveStatusUpdateCutoff('2026-09-15', dayShift)?.getTime(),
      vn('2026-09-15T17:00:00'),
    );
  });

  it('carries a night shift onto the next day first', () => {
    assert.equal(
      resolveShiftEndAt('2026-09-15', nightShift)?.getTime(),
      vn('2026-09-16T06:00:00'),
    );
    assert.equal(
      resolveStatusUpdateCutoff('2026-09-15', nightShift)?.getTime(),
      vn('2026-09-16T09:00:00'),
    );
  });

  it('reports no deadline rather than locking an Order it cannot read', () => {
    for (const [date, shift] of [
      [null, dayShift],
      [undefined, dayShift],
      ['2026-09-15', null],
      ['2026-09-15', { end_time: null }],
      ['not-a-date', dayShift],
    ]) {
      assert.equal(resolveStatusUpdateCutoff(date, shift), null);
    }
  });
});

describe('the deadline hook waits for the moment instead of polling', () => {
  it('arms exactly one timer aimed at the deadline', () => {
    assert.match(deadlineHook, /window\.setTimeout\(/);
    assert.match(deadlineHook, /Math\.max\(0, deadlineMs - Date\.now\(\)\)/);
    assert.match(deadlineHook, /window\.clearTimeout\(timer\)/);
    assert.doesNotMatch(deadlineHook, /setInterval/);
  });

  it('answers false when there is no deadline', () => {
    assert.match(deadlineHook, /return deadlineMs !== null && now > deadlineMs;/);
  });
});

describe('OrderDetailPage locks status actions once expired', () => {
  it('derives the cutoff from the Order own Sheet', () => {
    assert.match(page, /resolveStatusUpdateCutoff\(\s*order\?\.shift_order_sheet\?\.work_date,\s*order\?\.shift_order_sheet\?\.work_shift,/);
    assert.match(page, /const deadlinePassed = useDeadlinePassed\(statusUpdateCutoff\)/);
  });

  it('disables every action in the status block', () => {
    const block = page.match(/<div className="flex flex-wrap gap-2">[\s\S]*?<\/div>\n {8}<\/div>/)?.[0] ?? '';
    assert.ok(block, 'action block not found');
    for (const label of [
      'Xác nhận', 'Từ chối', 'Phân bổ vị trí', 'Xuất hàng',
      'Đã nhận hàng', 'Hoàn thành', 'Hủy order',
    ]) {
      assert.ok(block.includes(label), `missing action: ${label}`);
    }
    // Seven actions, seven gates. A button left ungated would stay clickable.
    assert.equal((block.match(/actionsLocked/g) ?? []).length, 7);
    assert.doesNotMatch(block, /disabled=\{mutating\}/);
    assert.match(page, /const actionsLocked = mutating \|\| isStatusUpdateExpired/);
  });

  it('shows the expiry banner', () => {
    assert.match(
      page,
      /\{isStatusUpdateExpired && \([\s\S]*?Đã quá thời hạn cho phép cập nhật trạng thái Order \(kết thúc ca \+ 3 giờ\)/,
    );
    assert.match(page, /Không thể tiếp tục thao tác trên Order này\./);
  });

  it('locks down when the backend refuses on its own clock', () => {
    // The client clock or its Sheet data can disagree; the server verdict wins.
    assert.match(
      page,
      /getApiErrorCode\(requestError\) === ORDER_STATUS_UPDATE_WINDOW_EXPIRED[\s\S]{0,80}setServerRefusedAsExpired\(true\)/,
    );
    assert.match(page, /const isStatusUpdateExpired = deadlinePassed \|\| serverRefusedAsExpired/);
  });
});

describe('the backend refusal reaches the operator', () => {
  it('maps the error code to the friendly wording', () => {
    const axiosError = {
      isAxiosError: true,
      message: 'Request failed with status code 403',
      response: {
        status: 403,
        data: {
          error: 'Không thể cập nhật trạng thái Order do đã quá thời hạn cho phép (kết thúc ca + 3 giờ).',
          code: ORDER_STATUS_UPDATE_WINDOW_EXPIRED,
        },
      },
    };
    assert.equal(
      getApiErrorMessage(axiosError, 'Không thể cập nhật order.'),
      'Đã quá thời hạn cho phép cập nhật trạng thái Order (kết thúc ca + 3 giờ). Không thể tiếp tục thao tác trên Order này.',
    );
  });
});
