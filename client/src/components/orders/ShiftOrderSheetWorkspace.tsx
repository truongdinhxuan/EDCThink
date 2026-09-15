import { faClock } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { exportShiftOrderSheet } from '../../api/shift-order-sheets.service';
import { getApiErrorMessage } from '../../api/errors';
import { PERMISSION_CODE } from '../../constants/permissions';
import { getWorkspacePath } from '../../constants/workspaces';
import { useAuth } from '../../context/AuthContext';
import { useCrudOffcanvas } from '../../hooks/useCrudOffcanvas';
import type { CrudFeedback } from '../../hooks/useCrudResource';
import { queryKeys } from '../../lib/queryKeys';
import { isOutsideShiftWindow } from '../../utils/workShiftWindow';
import type { OrderStatus } from '../../types/orders';
import type {
  ShiftOrderSheetCreateContext,
  ShiftOrderSheetDetail,
  ShiftOrderSheetOrderItem,
} from '../../types/shift-order-sheets';
import { InfoButton, SecondaryButton, TextButton } from '../common/Button';
import { CrudFeedbackToast } from '../crud/CrudPrimitives';
import { DrawerFormFooter } from '../offcanvas';
import { CreateOrderForm, type CreateOrderFormState } from './CreateOrderForm';
import { IncomingMarketOrdersSection } from './IncomingMarketOrdersSection';
import { OrderStatusBadge } from './OrderStatusBadge';
import { SheetOrderListSection } from './SheetOrderListSection';

const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const INITIAL_CREATE_STATE: CreateOrderFormState = {
  stage: 'editing',
  isDirty: false,
  isBusy: false,
};

const formatDate = (value: string): string => new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: BUSINESS_TIME_ZONE,
}).format(new Date(`${value}T00:00:00+07:00`));

const formatDateTime = (value: string | null | undefined): string => value
  ? new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: BUSINESS_TIME_ZONE,
  }).format(new Date(value))
  : '—';

const shiftLabel = (context: ShiftOrderSheetCreateContext): string => {
  const label = context.work_shift?.name || context.work_shift?.code || 'không xác định';
  return label.replace(/^ca\s+/i, '').trim() || context.work_shift?.code || 'không xác định';
};

interface MaterialRow {
  item: ShiftOrderSheetOrderItem;
  order: ShiftOrderSheetDetail['orders'][number];
}

export interface ShiftOrderSheetWorkspaceProps {
  context: ShiftOrderSheetCreateContext;
  sheet: ShiftOrderSheetDetail | null;
  mode: 'current' | 'history' | 'detail';
  onShowHistory?: () => void;
  onBackCurrent?: () => void;
}

export const ShiftOrderSheetWorkspace = ({
  context,
  sheet,
  mode,
  onShowHistory,
  onBackCurrent,
}: ShiftOrderSheetWorkspaceProps) => {
  const queryClient = useQueryClient();
  const { role, hasPermission } = useAuth();
  const {
    openCrud,
    updatePrimary,
    requestClosePrimary,
    closePrimary,
  } = useCrudOffcanvas();
  const ordersPath = getWorkspacePath(role, 'orders');
  const [createDrawer, setCreateDrawer] = useState<{ formId: string; formKey: string } | null>(null);
  const [createState, setCreateState] = useState<CreateOrderFormState>(INITIAL_CREATE_STATE);
  const [feedback, setFeedback] = useState<CrudFeedback | null>(null);
  const createSequence = useRef(0);
  const initialFocusRef = useRef<HTMLInputElement>(null);
  // "Các mã đang Order" is the creator's own working list, so it follows the
  // create permission alone. The "+ Thêm Order" action additionally needs the
  // Sheet to be the one currently being worked.
  const canCreateOrder = hasPermission(PERMISSION_CODE.SUPPLY_ORDER_CREATE);
  const canApproveOrder = hasPermission(PERMISSION_CODE.SUPPLY_ORDER_APPROVE);

  // Re-derive the verdict as time passes so the lock engages when the shift ends
  // while the page is open, instead of waiting for the next refetch.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const ticker = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(ticker);
  }, []);

  // Only the Sheet being worked can be "outside hours". A historical Sheet is
  // always past its window and must stay fully readable.
  const isOutsideWorkingHours = mode === 'current' && (
    context.shift_start_at && context.shift_end_at
      ? isOutsideShiftWindow(context.shift_start_at, context.shift_end_at, now)
      : context.is_outside_working_hours === true
  );

  const allowCreate = mode === 'current' && canCreateOrder && !isOutsideWorkingHours;
  const sheetId = sheet?.id ?? null;

  /**
   * True only when the user has drilled into one persisted Sheet: one market,
   * one shift, one day. The current-Sheet view and the aggregate lists are not
   * that, so Sheet-scoped actions (export, the Order list an approver acts on)
   * stay off there.
   */
  const isSingleSheetView = mode !== 'current' && Boolean(sheetId);

  const createContext = useMemo<ShiftOrderSheetCreateContext>(() => ({
    ...context,
    id: sheetId ?? context.id,
    leader: sheet?.leader ?? context.leader ?? null,
  }), [context, sheet?.leader, sheetId]);

  // One-line, non-focusable context reused by the drawer header and the sticky
  // operation bar so Create Order does not repeat Area/Ca/Ngày as large blocks.
  const compactContext = `Ca ${shiftLabel(context)} · ${formatDate(context.work_date)} · ${context.area?.code ?? '—'}`;

  const rows = useMemo<MaterialRow[]>(() => (sheet?.orders ?? [])
    .flatMap((order) => order.order_items.map((item) => ({ item, order })))
    .sort((left, right) => {
      const leftTime = left.order.submitted_at ?? left.order.created_at;
      const rightTime = right.order.submitted_at ?? right.order.created_at;
      const time = rightTime.localeCompare(leftTime);
      return time || right.item.created_at.localeCompare(left.item.created_at)
        || right.item.id.localeCompare(left.item.id);
    }), [sheet]);

  const exportMutation = useMutation({
    mutationFn: () => exportShiftOrderSheet(sheet!.id),
    onSuccess: ({ blob, fileName }) => {
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName ?? 'Phieu_Order_Ca.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    },
  });

  const resetCreateDrawer = useCallback(() => {
    setCreateDrawer(null);
    setCreateState(INITIAL_CREATE_STATE);
  }, []);

  const handleCreateSuccess = useCallback(async () => {
    const invalidations = [
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.lists }),
      queryClient.invalidateQueries({ queryKey: queryKeys.shiftOrderSheets.current }),
      queryClient.invalidateQueries({ queryKey: queryKeys.shiftOrderSheets.histories }),
    ];
    if (sheetId) {
      invalidations.push(queryClient.invalidateQueries({
        queryKey: queryKeys.shiftOrderSheets.detail(sheetId),
      }));
    }
    await Promise.allSettled(invalidations);
    setFeedback({ type: 'success', message: 'Order đã được gửi thành công.' });
    closePrimary();
  }, [closePrimary, queryClient, sheetId]);

  const renderCreateContent = useCallback((current: { formId: string; formKey: string }): ReactNode => (
    <CreateOrderForm
      key={current.formKey}
      formId={current.formId}
      sheetContext={createContext}
      compact
      initialFocusRef={initialFocusRef}
      onStateChange={setCreateState}
      onSuccess={handleCreateSuccess}
    />
  ), [createContext, handleCreateSuccess]);

  const renderCreateFooter = useCallback((
    current: { formId: string; formKey: string },
    state: CreateOrderFormState,
  ): ReactNode => {
    return (
      <DrawerFormFooter
        cancelLabel="Hủy"
        submitLabel="Gửi Order"
        submittingLabel="Đang gửi Order..."
        isSubmitting={state.isBusy}
        hint="Ctrl + Enter để gửi Order"
        formId={current.formId}
        onCancel={() => requestClosePrimary('cancel')}
      />
    );
  }, [requestClosePrimary]);

  useEffect(() => {
    if (!createDrawer) return;
    updatePrimary({
      title: 'Thêm Order',
      description: compactContext,
      content: renderCreateContent(createDrawer),
      footer: renderCreateFooter(createDrawer, createState),
      size: 'lg',
      isDirty: createState.isDirty,
      isBusy: createState.isBusy,
      preventCloseWhileBusy: true,
      initialFocusRef,
    });
  }, [
    compactContext,
    createDrawer,
    createState,
    renderCreateContent,
    renderCreateFooter,
    updatePrimary,
  ]);

  const openCreateOrder = (event: MouseEvent<HTMLButtonElement>) => {
    createSequence.current += 1;
    const next = {
      formId: `shift-order-create-form-${createSequence.current}`,
      formKey: `${sheet?.id ?? `${context.area_id}-${context.work_shift_id}-${context.work_date}`}-${createSequence.current}`,
    };
    setFeedback(null);
    setCreateState(INITIAL_CREATE_STATE);
    setCreateDrawer(next);
    openCrud({
      mode: 'create',
      title: 'Thêm Order',
      description: compactContext,
      content: renderCreateContent(next),
      footer: renderCreateFooter(next, INITIAL_CREATE_STATE),
      size: 'lg',
      isDirty: false,
      isBusy: false,
      preventCloseWhileBusy: true,
      initialFocusRef,
      triggerElement: event.currentTarget,
      onBeforeClose: () => true,
      onClosed: resetCreateDrawer,
    });
  };

  const titlePrefix = mode === 'history' ? 'Lịch sử — ' : '';
  const leaderName = sheet?.leader
    ? `${sheet.leader.first_name} ${sheet.leader.last_name}`.trim()
    : null;

  return (
    <section className="space-y-5">
      <CrudFeedbackToast feedback={feedback} onClose={() => setFeedback(null)} />
      <header className="sticky top-0 z-20 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            {mode === 'history' && (
              <p className="text-xs font-bold uppercase tracking-widest text-amber-600">Lịch sử</p>
            )}
            <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">
              {titlePrefix}Phiếu order ca {shiftLabel(context)} ngày {formatDate(context.work_date)}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Khu vực: <span className="font-semibold text-slate-900">{context.area?.name ?? 'Không xác định'}</span>
              {context.area?.code && <span className="ml-1 text-slate-400">({context.area.code})</span>}
            </p>
            {leaderName && <p className="mt-1 text-xs text-slate-500">Tổ trưởng: {leaderName}</p>}
          </div>
          <div className="flex flex-col gap-2 min-[360px]:flex-row min-[360px]:flex-wrap lg:justify-end">
            {allowCreate && (
              <button type="button" onClick={openCreateOrder} className={`${InfoButton} w-full min-[360px]:w-auto`}>
                + Thêm Order
              </button>
            )}
            {mode === 'current' && onShowHistory && (
              <button type="button" onClick={onShowHistory} className={`${SecondaryButton} w-full min-[360px]:w-auto`}>
                Lịch sử phiếu order ca
              </button>
            )}
            {mode === 'history' && onBackCurrent && (
              <button type="button" onClick={onBackCurrent} className={`${SecondaryButton} w-full min-[360px]:w-auto`}>
                ← Quay lại phiếu hiện tại
              </button>
            )}
            {isSingleSheetView && hasPermission(PERMISSION_CODE.SUPPLY_SHIFT_ORDER_SHEET_READ) && (
              <button
                type="button"
                className={`${SecondaryButton} w-full min-[360px]:w-auto`}
                disabled={exportMutation.isPending}
                onClick={() => exportMutation.mutate()}
              >
                {exportMutation.isPending ? 'Đang xuất...' : 'Xuất Excel'}
              </button>
            )}
          </div>
        </div>
      </header>


      {exportMutation.isError && (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {getApiErrorMessage(exportMutation.error, 'Không thể tạo file Excel. Vui lòng thử lại.')}
        </div>
      )}

      {/* Creator surface: only a user who may raise Orders needs the working
          list of codes for this Sheet. */}
      {canCreateOrder && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
            <h2 className="font-bold text-slate-900">Các mã đang Order</h2>
            <p className="mt-1 text-sm text-slate-500">
              {rows.length} mã vật tư trong {sheet?.orders.length ?? 0} Order
            </p>
          </div>

          {/* The lock covers the list only. The card heading above it and the
              page header both stay legible. */}
          <div className="relative">
            {rows.length === 0 ? (
              <div className="px-4 py-10 text-center sm:px-6">
                <p className="text-sm font-semibold text-slate-700">Ca này chưa có Order.</p>
                {allowCreate && (
                  <p className="mt-2 text-sm text-slate-500">Chọn “+ Thêm Order” để tạo Order đầu tiên cho ca hiện tại.</p>
                )}
              </div>
            ) : (
              <>
                {/* Mobile: dense stacked rows (no 1100px table). Mã vật tư + SL +
                    trạng thái lead; Order code / time / stack as a secondary line. */}
                <ul className="divide-y divide-slate-100 md:hidden">
                  {rows.map(({ item, order }) => {
                    const status = (order.status_lookup?.code ?? order.status) as OrderStatus;
                    const unit = item.unit?.symbol ?? item.unit?.code ?? '';
                    const stack = item.requested_stack_quantity && item.set_per_qty
                      ? `${item.requested_stack_quantity} × ${item.set_per_qty}`
                      : '—';
                    return (
                      <li key={item.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900">{item.supply?.code ?? '—'}</p>
                          {item.supply?.description && (
                            <p className="truncate text-xs text-slate-500">{item.supply.description}</p>
                          )}
                          <p className="mt-0.5 text-xs text-slate-400">
                            <Link to={`${ordersPath}/${order.id}`} className={TextButton}>{order.code}</Link>
                            <span className="ml-2">{formatDateTime(order.submitted_at ?? order.created_at)}</span>
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="tabular-nums font-semibold text-slate-900">{item.quantity_requested} {unit}</p>
                          <div className="mt-1"><OrderStatusBadge status={status} /></div>
                          {stack !== '—' && <p className="mt-0.5 text-xs text-slate-400">Stack {stack}</p>}
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {/* Tablet+/desktop: operational density (~40px rows), sticky header,
                    Mã vật tư frozen, low-priority columns fold in below xl. */}
                <div className="hidden max-h-[65vh] overflow-auto overscroll-contain md:block">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th scope="col" className="sticky left-0 z-20 bg-slate-50 px-3 py-2">Mã vật tư</th>
                        <th scope="col" className="hidden px-3 py-2 lg:table-cell">Mô tả</th>
                        <th scope="col" className="hidden px-3 py-2 xl:table-cell">Provider</th>
                        <th scope="col" className="px-3 py-2">SL yêu cầu</th>
                        <th scope="col" className="px-3 py-2">Đơn vị</th>
                        <th scope="col" className="hidden px-3 py-2 lg:table-cell">Stack</th>
                        <th scope="col" className="px-3 py-2">Order</th>
                        <th scope="col" className="px-3 py-2">Trạng thái</th>
                        <th scope="col" className="hidden px-3 py-2 xl:table-cell">Người tạo</th>
                        <th scope="col" className="hidden px-3 py-2 lg:table-cell">Thời gian</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map(({ item, order }) => {
                        const requester = order.requester
                          ? `${order.requester.first_name} ${order.requester.last_name}`.trim()
                          : 'Không xác định';
                        const status = (order.status_lookup?.code ?? order.status) as OrderStatus;
                        const stack = item.requested_stack_quantity && item.set_per_qty
                          ? `${item.requested_stack_quantity} × ${item.set_per_qty}`
                          : '—';
                        return (
                          <tr key={item.id} className="align-top hover:bg-slate-50/80">
                            <td className="sticky left-0 z-[1] bg-white px-3 py-2.5 font-semibold text-slate-900">{item.supply?.code ?? '—'}</td>
                            <td className="hidden max-w-64 whitespace-normal px-3 py-2.5 lg:table-cell">{item.supply?.description ?? '—'}</td>
                            <td className="hidden px-3 py-2.5 xl:table-cell">{item.provider ? `${item.provider.code} — ${item.provider.name}` : '—'}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{item.quantity_requested}</td>
                            <td className="px-3 py-2.5">{item.unit?.symbol ?? item.unit?.code ?? '—'}</td>
                            <td className="hidden px-3 py-2.5 tabular-nums lg:table-cell">{stack}</td>
                            <td className="px-3 py-2.5"><Link to={`${ordersPath}/${order.id}`} className={TextButton}>{order.code}</Link></td>
                            <td className="px-3 py-2.5"><OrderStatusBadge status={status} /></td>
                            <td className="hidden px-3 py-2.5 xl:table-cell">{requester}</td>
                            <td className="hidden whitespace-nowrap px-3 py-2.5 lg:table-cell">{formatDateTime(order.submitted_at ?? order.created_at)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {isOutsideWorkingHours && (
              <div
                role="status"
                className="absolute inset-0 z-10 flex items-center justify-center rounded-b-2xl bg-white/60 px-4 text-center backdrop-blur-[2px]"
              >
                <div className="max-w-xs">
                  <FontAwesomeIcon
                    icon={faClock}
                    className="text-2xl text-amber-500"
                    aria-hidden="true"
                  />
                  <p className="mt-2 text-sm font-semibold text-slate-900">
                    Ngoài giờ làm việc, không thể thêm order
                  </p>
                  {context.shift_end_at && (
                    <p className="mt-1 text-xs text-slate-500">
                      Ca {shiftLabel(context)} đã kết thúc lúc {formatDateTime(context.shift_end_at)}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Approver step one: which markets ordered out of this Area for the same
          shift instance. Older shifts stay in history. Only on the overview;
          repeating the market list inside one market's Sheet would be noise. */}
      {canApproveOrder && mode === 'current' && (
        <IncomingMarketOrdersSection context={context} />
      )}

      {/* Approver step two: the Orders on the market Sheet just opened, each
          linking on to /workspace/orders/:id where the decision is made. */}
      {canApproveOrder && isSingleSheetView && sheet && (
        <SheetOrderListSection orders={sheet.orders} />
      )}
    </section>
  );
};
