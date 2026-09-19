import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import {
  buildShiftOrderSheetExportRows,
  createShiftOrderSheetExportFilename,
  createShiftOrderSheetWorkbook,
  formatBusinessTime,
  SHIFT_ORDER_SHEET_EXPORT_HEADERS,
  SHIFT_ORDER_SHEET_WORKSHEET_NAME,
  NON_STANDARD_STACK_LABEL,
  type ShiftOrderSheetExportItem,
  type ShiftOrderSheetExportSource,
} from '../../src/services/shift-order-sheet-exporter';

const item = (overrides: Partial<ShiftOrderSheetExportItem> = {}): ShiftOrderSheetExportItem => ({
  id: 'item-normal',
  created_at: '2026-08-26T23:00:01Z',
  quantity_requested: 50,
  quantity_approved: null,
  quantity_issued: 0,
  set_per_qty: null,
  requested_stack_quantity: null,
  note: null,
  supply: {
    code: '71000001',
    description: 'Mã thường',
    category: { code: 'NORMAL' },
  },
  provider: { code: 'NCC-A', name: 'Nhà cung cấp A' },
  unit: { code: 'PCS', symbol: 'Cái' },
  ...overrides,
});

const source = (): ShiftOrderSheetExportSource => ({
  id: 'sheet-id',
  work_date: '2026-08-26',
  area: { code: 'EDC', name: 'EDC Logistics' },
  work_shift: { code: 'S3', name: 'Ca 3' },
  orders: [
    {
      id: 'order-normal',
      code: 'ORD-001',
      submitted_at: '2026-08-26T23:00:00Z',
      issued_at: null,
      note: 'Ghi chú Order',
      is_deleted: false,
      status: { code: 'PENDING', name: 'Chờ duyệt' },
      order_items: [item()],
    },
    {
      id: 'order-stack',
      code: 'ORD-002',
      submitted_at: '2026-08-27T00:00:00Z',
      issued_at: '2026-08-27T01:30:00Z',
      note: null,
      is_deleted: false,
      status: { code: 'ISSUED', name: 'Đã cấp hàng' },
      order_items: [
        item({
          id: 'item-stack-11',
          created_at: '2026-08-27T00:00:01Z',
          quantity_requested: 33,
          quantity_issued: 33,
          set_per_qty: 11,
          requested_stack_quantity: 3,
          note: 'Đúng 3 chồng',
          supply: {
            code: '71000861',
            description: 'Kiện sắt tiêu chuẩn',
            category: { code: 'KIEN_SAT_TC' },
          },
        }),
        item({
          id: 'item-stack-8',
          created_at: '2026-08-27T00:00:02Z',
          quantity_requested: 16,
          quantity_issued: 0,
          set_per_qty: 8,
          requested_stack_quantity: 2,
          supply: {
            code: '71000861',
            description: 'Kiện sắt tiêu chuẩn',
            category: { code: 'KIEN_SAT_TC' },
          },
          provider: { code: 'NCC-B', name: 'Nhà cung cấp B' },
        }),
      ],
    },
    {
      id: 'order-special',
      code: 'ORD-003',
      submitted_at: '2026-08-27T02:15:00+07:00',
      issued_at: null,
      note: null,
      is_deleted: false,
      status: { code: 'APPROVED', name: 'Đã duyệt' },
      order_items: [item({
        id: 'item-special',
        quantity_requested: 12,
        supply: {
          code: '71000999',
          description: 'Kiện sắt special',
          category: { code: 'KIEN_SAT_SPECIAL' },
        },
      })],
    },
    {
      id: 'order-partial',
      code: 'ORD-004',
      submitted_at: '2026-08-27T02:30:00+07:00',
      issued_at: '2026-08-27T02:40:00+07:00',
      note: null,
      is_deleted: false,
      status: { code: 'PARTIAL_ISSUED', name: 'Cấp một phần' },
      order_items: [item({
        id: 'item-normal-partial',
        quantity_requested: 50,
        quantity_issued: 20,
      })],
    },
  ],
});

test('maps normal, special, stack and partial quantity semantics without aggregation', () => {
  const rows = buildShiftOrderSheetExportRows(source());
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((row) => [row.supplyCode, row.quantity, row.stackQuantity]), [
    ['71000001', 50, NON_STANDARD_STACK_LABEL],
    ['71000861', 33, 3],
    ['71000861', 16, 2],
    ['71000999', 12, NON_STANDARD_STACK_LABEL],
    ['71000001', 20, NON_STANDARD_STACK_LABEL],
  ]);
  assert.equal(rows[0]?.provider, 'NCC-A — Nhà cung cấp A');
  assert.equal(rows[2]?.provider, 'NCC-B — Nhà cung cấp B');
  assert.equal(rows[0]?.note, 'Ghi chú Order');
  assert.equal(rows[1]?.note, 'Đúng 3 chồng');
  // Status wording comes from the database, not from a table in the code.
  assert.deepEqual(rows.map((row) => row.status), [
    'Chờ duyệt', 'Đã cấp hàng', 'Đã cấp hàng', 'Đã duyệt', 'Cấp một phần',
  ]);
  assert.equal(rows[0]?.unit, 'Cái');
});

test('reports the approved quantity once an approval exists', () => {
  const cut = source();
  cut.orders = [{
    ...cut.orders[0]!,
    status: { code: 'APPROVED', name: 'Đã duyệt' },
    order_items: [item({ quantity_requested: 10, quantity_approved: 4, quantity_issued: 0 })],
  }];
  // The approver cut 10 down to 4; the sheet must not keep advertising 10.
  assert.equal(buildShiftOrderSheetExportRows(cut)[0]?.quantity, 4);

  const approvedNothing = source();
  approvedNothing.orders = [{
    ...approvedNothing.orders[0]!,
    order_items: [item({ quantity_requested: 10, quantity_approved: 0 })],
  }];
  // 0 is a decision, not a missing value, so it is reported as 0.
  assert.equal(buildShiftOrderSheetExportRows(approvedNothing)[0]?.quantity, 0);

  const issued = source();
  issued.orders = [{
    ...issued.orders[0]!,
    order_items: [item({ quantity_requested: 10, quantity_approved: 4, quantity_issued: 3 })],
  }];
  assert.equal(buildShiftOrderSheetExportRows(issued)[0]?.quantity, 3);
});

test('drops cancelled Orders and keeps every other state', () => {
  const withCancelled = source();
  withCancelled.orders = [
    { ...withCancelled.orders[0]!, status: { code: 'CANCELLED', name: 'Đã hủy' } },
    { ...withCancelled.orders[2]!, status: { code: 'REJECTED', name: 'Từ chối' } },
  ];
  const rows = buildShiftOrderSheetExportRows(withCancelled);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.status, 'Từ chối');
});

test('formats timestamps in Asia/Ho_Chi_Minh independently from process timezone', () => {
  assert.equal(formatBusinessTime('2026-08-26T23:00:00Z'), '06:00');
  assert.equal(formatBusinessTime('2026-08-27T01:30:00Z'), '08:30');
  assert.equal(formatBusinessTime('2026-08-27T02:15:00+07:00'), '02:15');
  assert.equal(formatBusinessTime(null), '');
});

test('generates a valid XLSX with exact headers, numeric cells and blanks', async () => {
  const buffer = await createShiftOrderSheetWorkbook(source());
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const worksheet = workbook.getWorksheet(SHIFT_ORDER_SHEET_WORKSHEET_NAME);
  assert.ok(worksheet);
  const headerValues = worksheet.getRow(1).values;
  assert.ok(Array.isArray(headerValues));
  assert.deepEqual(
    headerValues.slice(1),
    [...SHIFT_ORDER_SHEET_EXPORT_HEADERS],
  );
  assert.equal(worksheet.rowCount, 6);
  // A=Mã hàng B=Tên mã C=Số lượng D=Đơn vị E=NCC F=Trạng thái
  // G=Số chồng H=Giờ order I=Giờ nhận hàng J=Note
  assert.equal(worksheet.getCell('C2').type, ExcelJS.ValueType.Number);
  assert.equal(worksheet.getCell('C2').value, 50);
  assert.equal(worksheet.getCell('D2').value, 'Cái');
  assert.equal(worksheet.getCell('F2').value, 'Chờ duyệt');
  assert.equal(worksheet.getCell('G2').value, NON_STANDARD_STACK_LABEL);
  assert.equal(worksheet.getCell('H2').value, '06:00');
  assert.equal(worksheet.getCell('I2').value, null);
  assert.equal(worksheet.getCell('G3').type, ExcelJS.ValueType.Number);
  assert.equal(worksheet.getCell('G3').value, 3);
  assert.equal(worksheet.getCell('I3').value, '08:30');
  // Whole units only, matching the integer quantity standard.
  // Column keys are not preserved through a load, so this is the "Số lượng" index.
  assert.equal(worksheet.getColumn(3).numFmt, '0');
});

test('creates readable deterministic filename from Sheet metadata', () => {
  assert.equal(
    createShiftOrderSheetExportFilename(source()),
    'Phieu_Order_Ca_EDC_S3_2026-08-26.xlsx',
  );
});

test('empty Sheet produces a valid header-only XLSX', async () => {
  const empty = source();
  empty.orders = [];
  const workbook = new ExcelJS.Workbook();
  const buffer = await createShiftOrderSheetWorkbook(empty);
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  assert.equal(workbook.getWorksheet(SHIFT_ORDER_SHEET_WORKSHEET_NAME)?.rowCount, 1);
});

test('never drops a line: unresolvable stack data blanks the cell and explains itself', () => {
  const inconsistent = source();
  inconsistent.orders = [{
    ...inconsistent.orders[1]!,
    order_items: [item({
      id: 'partial-stack',
      quantity_requested: 33,
      quantity_issued: 11,
      set_per_qty: 11,
      requested_stack_quantity: 3,
      supply: {
        code: '71000861',
        description: 'Kiện sắt tiêu chuẩn',
        category: { code: 'KIEN_SAT_TC' },
      },
    })],
  }];
  // A dropped row is never picked and nobody notices; a blank cell with a
  // reason in Note still reaches the floor.
  const rows = buildShiftOrderSheetExportRows(inconsistent);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.supplyCode, '71000861');
  assert.equal(rows[0]?.quantity, 11);
  assert.equal(rows[0]?.stackQuantity, null);
  assert.match(rows[0]?.note ?? '', /Đã cấp một phần \(11\/33\)/);
});

test('keeps the operator note and appends the export warning after it', () => {
  const missing = source();
  missing.orders = [{
    ...missing.orders[1]!,
    order_items: [item({
      id: 'missing-stack',
      note: 'Ghi chú của tổ trưởng',
      quantity_requested: 16,
      quantity_issued: 0,
      set_per_qty: 8,
      requested_stack_quantity: null,
      supply: {
        code: '71000861',
        description: 'Kiện sắt tiêu chuẩn',
        category: { code: 'KIEN_SAT_TC' },
      },
    })],
  }];
  const row = buildShiftOrderSheetExportRows(missing)[0];
  assert.equal(row?.stackQuantity, null);
  assert.equal(row?.note, 'Ghi chú của tổ trưởng | Thiếu số chồng yêu cầu');
});

test('the export query loads everything the sheet columns need', () => {
  const service = readFileSync(
    resolve(process.cwd(), 'src/services/shift-order-sheets.service.ts'),
    'utf8',
  );
  const select = service.slice(
    service.indexOf('const SHEET_EXPORT_SELECT'),
    service.indexOf('export class ShiftOrderSheetsService'),
  );
  // Each of these backs a column; a missing one silently blanks it, because the
  // exporter can only render what the query loaded.
  for (const field of [
    'status_lookup:order_statuses',
    'quantity_approved',
    'unit:units!order_items_unit_id_fkey',
  ]) {
    assert.ok(select.includes(field), `SHEET_EXPORT_SELECT is missing ${field}`);
  }
});
