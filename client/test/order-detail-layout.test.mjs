import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const page = readFileSync(resolve(process.cwd(), 'src/pages/orders/OrderDetailPage.tsx'), 'utf8')
  .replace(/\r\n/g, '\n');
const at = (text) => {
  const index = page.indexOf(text);
  assert.ok(index > -1, `missing: ${text}`);
  return index;
};

describe('Order detail layout', () => {
  it('splits into a 5/12 working column and a 7/12 items column from lg', () => {
    assert.match(page, /lg:grid-cols-12/);
    assert.match(page, /space-y-3 sm:space-y-4 lg:col-span-5/);
    assert.match(page, /lg:sticky lg:top-0 lg:col-span-7/);
  });

  it('pins the items card at a fixed viewport height and scrolls long lists inside it', () => {
    // A fixed height (not max-height), so a short list still fills the pane.
    // The exact value is tuned by hand in the page.
    assert.match(page, /lg:h-\[calc\([^)]*\)\]/);
    assert.doesNotMatch(page, /lg:max-h-\[calc\(100dvh-7\.5rem\)\]/);
    assert.match(page, /min-h-0 flex-1 overflow-auto overscroll-contain/);
    assert.match(page, /<thead className="sticky top-0/);
  });

  it('shows the items in five columns that fit the narrower column', () => {
    const head = page.slice(at('<thead className="sticky top-0'), at('</thead>'));
    assert.equal((head.match(/<th /g) ?? []).length, 5);
    assert.doesNotMatch(head, /Provider|Ghi chú/);
  });

  it('uses larger type in the items card than elsewhere on the page', () => {
    const card = page.slice(at('Pinned to the viewport'), at('{confirmationTarget && ('));
    assert.match(card, /<table className="w-full text-left text-base">/);
    assert.match(card, /<h2 className="text-base [^"]*font-bold text-slate-900[^"]*">Thông tin cấp hàng<\/h2>/);
    assert.match(card, /textSize="md"/);
    // Only the uppercase column headings stay at text-xs.
    assert.equal((card.match(/text-xs/g) ?? []).length, 1);
  });

  it('keeps the order info in one card, then history and actions in one card, left', () => {
    const info = at('Thông tin order');
    const history = at('Lịch sử duyệt / từ chối');
    const actions = at('Thao tác theo trạng thái và quyền');
    const stack = at('Xác nhận số chồng — kiện tiêu chuẩn');
    const items = at('Thông tin cấp hàng');
    assert.ok(info < history && history < actions && actions < stack && stack < items);
    // Notes live in the info card now, not in their own row below the page.
    assert.ok(at('label="Lý do từ chối"') < history);
    // The status panels open inside the actions card, before the stack list.
    assert.ok(actions < at('title="Duyệt số lượng"') && at('title="Duyệt số lượng"') < stack);
  });
});
