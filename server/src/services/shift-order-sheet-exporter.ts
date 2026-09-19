import ExcelJS from 'exceljs';

export const SHIFT_ORDER_SHEET_EXPORT_HEADERS = [
  'Mã hàng',
  'Tên mã',
  'Số lượng',
  'Đơn vị',
  'Nhà cung cấp',
  'Trạng thái',
  'Số chồng (nếu có)',
  'Giờ order',
  'Giờ nhận hàng',
  'Note',
] as const;

export const SHIFT_ORDER_SHEET_WORKSHEET_NAME = 'Phiếu Order Ca';
export const SHIFT_ORDER_SHEET_EXPORT_TIME_ZONE = 'Asia/Ho_Chi_Minh';

/** Only this category is counted in stacks; everything else says so in the cell. */
const STACK_CATEGORY_CODE = 'KIEN_SAT_TC';

/** Written into "Số chồng (nếu có)" for anything that is not a standard crate. */
export const NON_STANDARD_STACK_LABEL = 'Không phải kiện tiêu chuẩn';

/** Orders in this state are not work anybody should do, so they never reach the file. */
export const EXCLUDED_EXPORT_STATUS_CODES: readonly string[] = ['CANCELLED'];

export interface ShiftOrderSheetExportItem {
  id: string;
  created_at: string;
  quantity_requested: number | string;
  quantity_approved: number | string | null;
  quantity_issued: number | string | null;
  set_per_qty: number | string | null;
  requested_stack_quantity: number | string | null;
  note: string | null;
  supply: {
    code: string;
    description: string | null;
    category: { code: string } | null;
  } | null;
  provider: { code: string; name: string } | null;
  unit: { code: string; symbol: string | null } | null;
}

export interface ShiftOrderSheetExportOrder {
  id: string;
  code: string;
  submitted_at: string | null;
  issued_at: string | null;
  note: string | null;
  is_deleted: boolean;
  status: { code: string; name: string | null } | null;
  order_items: ShiftOrderSheetExportItem[];
}

export interface ShiftOrderSheetExportSource {
  id: string;
  work_date: string;
  area: { code: string; name: string } | null;
  work_shift: { code: string; name: string } | null;
  orders: ShiftOrderSheetExportOrder[];
}

export interface ShiftOrderSheetExportRow {
  supplyCode: string;
  supplyName: string;
  quantity: number | null;
  unit: string;
  provider: string;
  status: string;
  stackQuantity: number | string | null;
  orderedTime: string;
  issuedTime: string;
  note: string;
}

export class ShiftOrderSheetExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShiftOrderSheetExportError';
  }
}

interface ResolvedCell<T> {
  value: T;
  warning?: string;
}

/**
 * Parses a quantity, or returns null when the value cannot be trusted.
 *
 * A picking sheet must never lose a line: a supply code with a blank cell can
 * still be chased down on the floor, whereas a dropped row is simply never
 * picked and nobody notices. So bad data degrades the one cell and explains
 * itself in Note, instead of failing the whole export.
 */
const parseQuantity = (value: number | string | null): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

export const formatBusinessTime = (value: string | null): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: SHIFT_ORDER_SHEET_EXPORT_TIME_ZONE,
  }).format(date);
};

/**
 * The most settled quantity the Order has reached: issued, else approved, else
 * requested. Issued is the number the supply desk hands over to packing, so it
 * wins; an approval that cut the request must never be reported as the original
 * request.
 *
 * quantity_approved of 0 is a real decision (nothing approved) and is reported
 * as such. Only a null approval, meaning nobody has reviewed it yet, falls
 * through to the requested quantity.
 */
const resolveQuantity = (item: ShiftOrderSheetExportItem): ResolvedCell<number | null> => {
  const issued = parseQuantity(item.quantity_issued);
  if (issued !== null && issued > 0) return { value: issued };

  const approved = parseQuantity(item.quantity_approved);
  if (approved !== null) return { value: approved };

  const requested = parseQuantity(item.quantity_requested);
  if (requested === null) {
    return { value: null, warning: 'Số lượng yêu cầu không hợp lệ' };
  }
  return { value: requested };
};

/**
 * Three distinct outcomes, and they must stay distinct:
 * a number (counted in stacks), the NON_STANDARD label (stacks do not apply),
 * or null with a warning (stacks apply but the data cannot produce one).
 */
const resolveStackQuantity = (
  item: ShiftOrderSheetExportItem,
  categoryCode: string,
): ResolvedCell<number | string | null> => {
  if (categoryCode !== STACK_CATEGORY_CODE) {
    return { value: NON_STANDARD_STACK_LABEL };
  }

  const requested = parseQuantity(item.quantity_requested);
  const issued = parseQuantity(item.quantity_issued) ?? 0;

  if (issued > 0 && requested !== null && issued < requested) {
    return {
      value: null,
      warning: `Đã cấp một phần (${issued}/${requested}), chưa chốt được số chồng`,
    };
  }

  if (issued > 0) {
    const setPerQty = parseQuantity(item.set_per_qty);
    if (setPerQty === null || setPerQty <= 0) {
      return { value: null, warning: 'Thiếu SET/chồng nên không tính được số chồng đã cấp' };
    }
    if (issued % setPerQty !== 0) {
      return {
        value: null,
        warning: `Số đã cấp (${issued}) không chia hết cho SET/chồng (${setPerQty})`,
      };
    }
    return { value: issued / setPerQty };
  }

  const requestedStack = parseQuantity(item.requested_stack_quantity);
  if (requestedStack === null) {
    return { value: null, warning: 'Thiếu số chồng yêu cầu' };
  }
  return { value: requestedStack };
};

const firstNonBlank = (...values: Array<string | null>): string => {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) return normalized;
  }
  return '';
};

/** Keeps the operator's own note and appends whatever the export could not compute. */
const composeNote = (base: string, warnings: string[]): string =>
  [base, ...warnings].filter(Boolean).join(' | ');

export const buildShiftOrderSheetExportRows = (
  source: ShiftOrderSheetExportSource,
): ShiftOrderSheetExportRow[] => source.orders
  .filter((order) => !order.is_deleted)
  // Every other state stays on the sheet and is told apart by "Trạng thái";
  // the reader does that filtering by eye.
  .filter((order) => !EXCLUDED_EXPORT_STATUS_CODES.includes(order.status?.code ?? ''))
  .flatMap((order) => order.order_items.map((item) => ({ order, item })))
  .sort((left, right) => (
    (left.order.submitted_at ?? '').localeCompare(right.order.submitted_at ?? '')
    || left.order.code.localeCompare(right.order.code)
    || left.item.created_at.localeCompare(right.item.created_at)
    || left.item.id.localeCompare(right.item.id)
  ))
  .map(({ order, item }) => {
    const categoryCode = item.supply?.category?.code ?? '';
    const quantity = resolveQuantity(item);
    const stack = resolveStackQuantity(item, categoryCode);
    return {
      supplyCode: item.supply?.code ?? '',
      supplyName: item.supply?.description?.trim() ?? '',
      quantity: quantity.value,
      unit: firstNonBlank(item.unit?.symbol ?? null, item.unit?.code ?? null),
      provider: item.provider
        ? `${item.provider.code} — ${item.provider.name}`
        : '',
      // Taken straight from order_statuses so the wording stays the database's.
      status: firstNonBlank(order.status?.name ?? null, order.status?.code ?? null),
      stackQuantity: stack.value,
      orderedTime: formatBusinessTime(order.submitted_at),
      issuedTime: formatBusinessTime(order.issued_at),
      note: composeNote(
        firstNonBlank(item.note, order.note),
        [quantity.warning, stack.warning].filter((text): text is string => Boolean(text)),
      ),
    };
  });

const sanitizeFilenameSegment = (value: string): string => value
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9_-]+/g, '_')
  .replace(/^_+|_+$/g, '')
  || 'NA';

export const createShiftOrderSheetExportFilename = (
  source: ShiftOrderSheetExportSource,
): string => [
  'Phieu_Order_Ca',
  sanitizeFilenameSegment(source.area?.code ?? 'AREA'),
  sanitizeFilenameSegment(source.work_shift?.code ?? 'SHIFT'),
  sanitizeFilenameSegment(source.work_date),
].join('_').concat('.xlsx');

export const createShiftOrderSheetWorkbook = async (
  source: ShiftOrderSheetExportSource,
): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'VF Supply';
  workbook.created = new Date(0);
  workbook.modified = new Date(0);

  const worksheet = workbook.addWorksheet(SHIFT_ORDER_SHEET_WORKSHEET_NAME);
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = 'A1:J1';
  // Order and count must match SHIFT_ORDER_SHEET_EXPORT_HEADERS exactly: the
  // header row is written positionally, the data rows by key.
  worksheet.columns = [
    { key: 'supplyCode', width: 18 },
    { key: 'supplyName', width: 36 },
    { key: 'quantity', width: 12 },
    { key: 'unit', width: 10 },
    { key: 'provider', width: 30 },
    { key: 'status', width: 16 },
    { key: 'stackQuantity', width: 24 },
    { key: 'orderedTime', width: 14 },
    { key: 'issuedTime', width: 16 },
    { key: 'note', width: 40 },
  ];
  worksheet.addRow([...SHIFT_ORDER_SHEET_EXPORT_HEADERS]);

  const header = worksheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A5F' },
  };
  header.alignment = { vertical: 'middle', horizontal: 'center' };
  header.height = 24;

  for (const row of buildShiftOrderSheetExportRows(source)) {
    worksheet.addRow({
      ...row,
      supplyCode: row.supplyCode || null,
      supplyName: row.supplyName || null,
      quantity: row.quantity,
      unit: row.unit || null,
      provider: row.provider || null,
      status: row.status || null,
      stackQuantity: row.stackQuantity ?? null,
      orderedTime: row.orderedTime || null,
      issuedTime: row.issuedTime || null,
      note: row.note || null,
    });
  }

  // Supply is counted in whole units. The stack column also carries the
  // NON_STANDARD label on some rows; a number format leaves text cells alone.
  worksheet.getColumn('quantity').numFmt = '0';
  worksheet.getColumn('stackQuantity').numFmt = '0';
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: 'top', wrapText: true };
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
};
