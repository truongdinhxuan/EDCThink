import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRef, useMemo, useState, type MouseEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  getApiErrorCode,
  getApiErrorDetails,
  getApiErrorMessage,
  ORDER_STATUS_UPDATE_WINDOW_EXPIRED,
} from "../../api/errors";
import { listAllocationConfirmReasons } from "../../api/lookups.service";
import {
  approveOrder,
  cancelOrder,
  completeOrder,
  confirmOrderStackItem,
  getOrder,
  issueOrder,
  receiveOrder,
  rejectOrder,
} from "../../api/orders.service";
import {
  ErrorButton,
  getButtonClassName,
  InfoButton,
  SecondaryButton,
  TextButton,
} from "../../components/common/Button";
import { CardSkeleton } from "../../components/common/skeleton";

/**
 * The status-action row can show up to seven buttons at once, and which ones
 * depends on status and permissions. At the default size they wrap onto a third
 * line on a 1366px screen and push the item table below the fold, so this row
 * alone drops a step. Every other button on the page keeps the normal size.
 */
const ACTION_INFO = getButtonClassName({ variant: "info", size: "sm" });
const ACTION_ERROR = getButtonClassName({ variant: "error", size: "sm" });
const ACTION_VIOLET = getButtonClassName({ variant: "violet", size: "sm" });
const ACTION_CYAN = getButtonClassName({ variant: "cyan", size: "sm" });
const ACTION_SUCCESS = getButtonClassName({ variant: "success", size: "sm" });
const ACTION_SECONDARY = getButtonClassName({ variant: "secondary", size: "sm" });

import { OrderStatusBadge } from "../../components/orders/OrderStatusBadge";
import { StockAvailabilityWarning } from "../../components/orders/StockAvailabilityWarning";
import { CrudModal, FieldError, inputClassName, labelClassName } from "../../components/crud/CrudPrimitives";
import { PERMISSION_CODE } from "../../constants/permissions";
import { getWorkspacePath } from "../../constants/workspaces";
import { useAuth } from "../../context/AuthContext";
import { useCrudOffcanvas } from "../../hooks/useCrudOffcanvas";
import { useDeadlinePassed } from "../../hooks/useDeadlinePassed";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { queryKeys } from "../../lib/queryKeys";
import { resolveStatusUpdateCutoff } from "../../utils/workShiftWindow";
import type {
  NormalIssueStockConflictDetails,
  Order,
  OrderAllocationLocation,
  OrderItem,
  OrderItemAllocation,
  StackItemConfirmation,
} from "../../types/orders";

type ActionPanel = "approve" | "issue" | null;
type ItemValues = Record<string, { quantity: string; note?: string }>;

const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "—";

const itemRemaining = (item: OrderItem) =>
  Math.max(0, Number(item.quantity_approved ?? 0) - Number(item.quantity_issued ?? 0));

const approvedStackQuantity = (item: OrderItem): number | null => {
  const approved = Number(item.quantity_approved);
  const setPerQty = Number(item.set_per_qty);
  if (
    item.set_per_qty === null ||
    !Number.isFinite(approved) ||
    !Number.isFinite(setPerQty) ||
    approved <= 0 ||
    setPerQty <= 0 ||
    approved % setPerQty !== 0
  ) return null;
  return approved / setPerQty;
};

/**
 * Where one KIEN_SAT_TC item stands. Data vật tư confirms one stack count per
 * item; that count may sit below or above the approval (with a reason) and is
 * exactly what ships. There is no "short of approval" state any more: once
 * confirmed, the item is ready.
 */
interface StackItemState {
  approvedStacks: number | null;
  confirmation: OrderItemAllocation | null;
  confirmedStacks: number | null;
  /** Rejected at review (approved 0): nothing to confirm or ship. */
  rejected: boolean;
  issued: boolean;
  ready: boolean;
}

const getStackItemState = (item: OrderItem): StackItemState => {
  const confirmation = item.allocations?.[0] ?? null;
  const rejected = item.quantity_approved !== null && Number(item.quantity_approved) === 0;
  const issued = confirmation?.status === 'ISSUED';
  return {
    approvedStacks: approvedStackQuantity(item),
    confirmation,
    confirmedStacks: confirmation?.actual_stack_quantity ?? null,
    rejected,
    issued,
    ready: rejected || issued || confirmation?.status === 'CONFIRMED',
  };
};

const locationCodes = (locations: OrderAllocationLocation[] | undefined) =>
  locations && locations.length > 0
    ? locations.map((location) => location.code).join(', ')
    : 'Chưa gắn vị trí';

const describeConfirmation = (
  confirmation: StackItemConfirmation,
  reasonName: string | undefined,
): string => {
  const { actual_stack_quantity: actual, approved_stack_quantity: approved } = confirmation;
  return [
    actual === approved
      ? `Đã xác nhận đủ ${actual} chồng. Có thể xuất hàng.`
      : `Đã xác nhận ${actual}/${approved} chồng${reasonName ? ` (${reasonName})` : ''}. Sẽ xuất đúng ${actual} chồng.`,
    confirmation.corrected_stack_quantity > 0
      ? `Đã trừ ${confirmation.corrected_stack_quantity} chồng tồn sổ không có thật.`
      : null,
    confirmation.discrepancy_id ? 'Đã mở phiếu kiểm kê cho mã này.' : null,
  ].filter(Boolean).join(' ');
};

const OrderDetailPage = () => {
  const { openConfirm } = useCrudOffcanvas();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const shiftOrderSheetContextId = searchParams.get('shiftOrderSheetId') ?? undefined;
  const { user, role, hasPermission, isSystemAdmin } = useAuth();
  const ordersPath = getWorkspacePath(role, "orders");
  const queryClient = useQueryClient();
  const orderQuery = useQuery({
    queryKey: queryKeys.orders.detail(id ?? ''),
    queryFn: ({ signal }) => getOrder(id!, signal),
    enabled: Boolean(id),
  });
  // Undefined until the Order loads, so the tab shows the app name instead of a
  // placeholder that is about to be replaced by the real code.
  useDocumentTitle(orderQuery.data?.code && `Order ${orderQuery.data.code}`);
  const orderMutation = useMutation({
    mutationFn: (operation: () => Promise<Order>) => operation(),
  });
  const confirmationMutation = useMutation({
    mutationFn: ({
      orderItemId,
      actualStackQuantity,
      reasonCode,
      reasonNote,
    }: {
      orderItemId: string;
      actualStackQuantity: number;
      reasonCode?: string;
      reasonNote?: string;
    }) => confirmOrderStackItem(id!, orderItemId, {
      actual_stack_quantity: actualStackQuantity,
      reason_code: reasonCode,
      reason_note: reasonNote,
    }),
  });
  const order = orderQuery.data ?? null;
  const loading = orderQuery.isPending;
  const loadError = orderQuery.isError
    ? getApiErrorMessage(orderQuery.error, "Không thể tải order.")
    : null;
  const [actionError, setActionError] = useState<string | null>(null);
  const [issueConflict, setIssueConflict] =
    useState<NormalIssueStockConflictDetails | null>(null);
  const mutating = orderMutation.isPending || confirmationMutation.isPending;
  // Status changes close three hours after the Order's shift ends. The backend
  // refuses them regardless; this only keeps the operator from filling in a
  // panel that is going to be rejected.
  const statusUpdateCutoff = resolveStatusUpdateCutoff(
    order?.shift_order_sheet?.work_date,
    order?.shift_order_sheet?.work_shift,
  );
  const deadlinePassed = useDeadlinePassed(statusUpdateCutoff);
  // Set when the backend refuses on its own clock, so a client whose data or
  // clock disagreed still locks down immediately.
  const [serverRefusedAsExpired, setServerRefusedAsExpired] = useState(false);
  const isStatusUpdateExpired = deadlinePassed || serverRefusedAsExpired;
  const actionsLocked = mutating || isStatusUpdateExpired;
  const [panel, setPanel] = useState<ActionPanel>(null);
  const [itemValues, setItemValues] = useState<ItemValues>({});
  const [confirmationTarget, setConfirmationTarget] = useState<OrderItem | null>(null);
  const [actualStackQuantity, setActualStackQuantity] = useState('');
  const [confirmationReasonCode, setConfirmationReasonCode] = useState('');
  const [confirmationNote, setConfirmationNote] = useState('');
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null);
  // Only needed once someone opens the confirm dialog; it is a short, stable list.
  const confirmReasonsQuery = useQuery({
    queryKey: queryKeys.allocationConfirmReasons.lookup({ isActive: true }),
    queryFn: ({ signal }) => listAllocationConfirmReasons(
      { page: 1, pageSize: 50, isActive: true },
      signal,
    ),
    enabled: confirmationTarget !== null,
    staleTime: 5 * 60 * 1000,
  });
  const confirmReasons = useMemo(
    () => confirmReasonsQuery.data?.data ?? [],
    [confirmReasonsQuery.data],
  );

  const items = useMemo(() => order?.order_items ?? [], [order]);
  const actorId = user?.publicData.id ?? user?.id;
  const isPackingOwner = Boolean(
    order &&
    (
      isSystemAdmin ||
      (
        hasPermission(PERMISSION_CODE.SUPPLY_ORDER_CREATE) &&
        actorId === order.requested_by &&
        user?.publicData.area_id === order.to_area_id
      )
    ),
  );
  const isApprover = hasPermission(PERMISSION_CODE.SUPPLY_ORDER_APPROVE);
  const canConfirmStacks = hasPermission(
    PERMISSION_CODE.SUPPLY_ORDER_CONFIRM_ALLOCATION,
  );
  const isIssuer = hasPermission(PERMISSION_CODE.SUPPLY_ORDER_ISSUE);
  const stackItems = useMemo(
    () => items.filter((item) => item.set_per_qty !== null),
    [items],
  );
  const normalIssueItems = useMemo(
    () => items.filter((item) => item.set_per_qty === null && itemRemaining(item) > 0),
    [items],
  );
  const stackStates = useMemo(
    () => new Map(stackItems.map((item) => [item.id, getStackItemState(item)])),
    [stackItems],
  );
  const stackItemsNotReady = useMemo(
    () => stackItems.filter((item) => !stackStates.get(item.id)?.ready),
    [stackItems, stackStates],
  );
  // Approved before whole-stack approval was enforced; nothing can confirm these.
  const incompatibleStackItems = useMemo(
    () => stackItems.filter((item) => {
      const state = stackStates.get(item.id);
      return state && !state.rejected && state.approvedStacks === null && item.quantity_approved !== null;
    }),
    [stackItems, stackStates],
  );
  const canCancel = Boolean(order && isPackingOwner && order.status === "PENDING");
  const canApprove = Boolean(order && isApprover && order.status === "PENDING");
  const hasIssueAction = Boolean(
    order && isIssuer && ["APPROVED", "PARTIAL_ISSUED"].includes(order.status),
  );
  const canIssue = hasIssueAction && stackItemsNotReady.length === 0;
  const canReceive = Boolean(order && isPackingOwner && order.status === "ISSUED");
  const canComplete = Boolean(order && isIssuer && ["ISSUED", "RECEIVED"].includes(order.status));
  const canConfirmItem = (item: OrderItem) => {
    const state = stackStates.get(item.id);
    return Boolean(
      order?.status === 'APPROVED'
      && canConfirmStacks
      && state
      && !state.rejected
      && state.approvedStacks !== null
      && state.confirmation === null,
    );
  };
  const canConfirmAnyStack = stackItems.some(canConfirmItem);
  const showStackSection = stackItems.some((item) => item.quantity_approved !== null);

  const runMutation = async (
    operation: () => Promise<Order>,
    affectsStock = false,
    onError?: (error: unknown) => void,
    throwOnError = false,
  ) => {
    setActionError(null);
    setIssueConflict(null);
    try {
      const updated = await orderMutation.mutateAsync(operation);
      queryClient.setQueryData(queryKeys.orders.detail(updated.id), updated);
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.lists });
      await queryClient.invalidateQueries({ queryKey: queryKeys.shiftOrderSheets.histories });
      const affectedSheetId = updated.shift_order_sheet_id ?? shiftOrderSheetContextId;
      if (affectedSheetId) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.shiftOrderSheets.detail(affectedSheetId),
        });
      }
      if (affectsStock) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.stockBalances.all }),
          queryClient.invalidateQueries({ queryKey: queryKeys.stockTransactions.all }),
          queryClient.invalidateQueries({ queryKey: queryKeys.supplyStackOptions.all }),
          // Issuing more stacks than the books hold opens a recount.
          queryClient.invalidateQueries({ queryKey: queryKeys.inventoryDiscrepancies.all }),
        ]);
      }
      setPanel(null);
      return updated;
    } catch (requestError) {
      const message = getApiErrorMessage(requestError, "Không thể cập nhật order.");
      if (getApiErrorCode(requestError) === ORDER_STATUS_UPDATE_WINDOW_EXPIRED) {
        setServerRefusedAsExpired(true);
      }
      setActionError(message);
      onError?.(requestError);
      if (throwOnError) throw new Error(message, { cause: requestError });
      return undefined;
    }
  };

  const openRejectConfirmation = (event: MouseEvent<HTMLButtonElement>) => {
    if (!id) return;
    const reasonRef = createRef<HTMLTextAreaElement>();
    openConfirm({
      title: 'Từ chối Order?',
      description: `Order “${order?.code ?? ''}” sẽ chuyển sang trạng thái REJECTED.`,
      confirmLabel: 'Từ chối',
      cancelLabel: 'Quay lại',
      variant: 'danger',
      size: 'md',
      triggerElement: event.currentTarget,
      content: (
        <label className={labelClassName}>
          Lý do từ chối *
          <textarea ref={reasonRef} rows={4} maxLength={2000} className={inputClassName} placeholder="Nhập lý do từ chối" />
        </label>
      ),
      onConfirm: async () => {
        const rejectedReason = reasonRef.current?.value.trim() ?? '';
        if (!rejectedReason) throw new Error('Lý do từ chối là bắt buộc.');
        await runMutation(
          () => rejectOrder(id, { rejected_reason: rejectedReason }),
          false,
          undefined,
          true,
        );
      },
    });
  };

  const openCancelConfirmation = (event: MouseEvent<HTMLButtonElement>) => {
    if (!id || !order) return;
    const reasonRef = createRef<HTMLTextAreaElement>();
    openConfirm({
      title: 'Hủy Order?',
      description: `Order “${order.code}” đang PENDING; lý do hủy là bắt buộc.`,
      confirmLabel: 'Hủy Order',
      cancelLabel: 'Quay lại',
      variant: 'danger',
      size: 'md',
      triggerElement: event.currentTarget,
      content: (
        <label className={labelClassName}>
          Lý do hủy *
          <textarea ref={reasonRef} rows={4} maxLength={2000} className={inputClassName} placeholder="Nhập lý do hủy" />
        </label>
      ),
      onConfirm: async () => {
        const cancelReason = reasonRef.current?.value.trim() ?? '';
        if (!cancelReason) {
          throw new Error('Lý do hủy là bắt buộc.');
        }
        await runMutation(
          () => cancelOrder(id, { cancel_reason: cancelReason }),
          false,
          undefined,
          true,
        );
      },
    });
  };

  const openConfirmation = (item: OrderItem) => {
    setActionError(null);
    setConfirmationMessage(null);
    setConfirmationTarget(item);
    setActualStackQuantity(String(approvedStackQuantity(item) ?? ''));
    setConfirmationReasonCode('');
    setConfirmationNote('');
  };

  const confirmTargetApproved = confirmationTarget
    ? approvedStackQuantity(confirmationTarget)
    : null;
  const confirmActual = Number(actualStackQuantity);
  const confirmActualValid = actualStackQuantity.trim() !== ''
    && Number.isInteger(confirmActual)
    && confirmActual >= 0;
  // Which side of the approval the typed count sits on; null when equal or unknown.
  const confirmDirection = confirmActualValid && confirmTargetApproved !== null
    && confirmActual !== confirmTargetApproved
    ? (confirmActual < confirmTargetApproved ? 'LOWER' : 'HIGHER')
    : null;
  const confirmReasonOptions = useMemo(
    () => confirmReasons.filter((reason) => reason.direction === confirmDirection),
    [confirmReasons, confirmDirection],
  );
  const selectedConfirmReason = confirmReasonOptions.find(
    (reason) => reason.code === confirmationReasonCode,
  );

  const submitStackConfirmation = async () => {
    if (!id || !confirmationTarget) return;
    if (!confirmActualValid) {
      setActionError('Số chồng xác nhận phải là số nguyên lớn hơn hoặc bằng 0.');
      return;
    }
    if (confirmDirection && !selectedConfirmReason) {
      setActionError('Số chồng khác số đã duyệt: phải chọn lý do.');
      return;
    }

    setActionError(null);
    try {
      const result = await confirmationMutation.mutateAsync({
        orderItemId: confirmationTarget.id,
        actualStackQuantity: confirmActual,
        reasonCode: confirmDirection ? selectedConfirmReason?.code : undefined,
        reasonNote: confirmDirection ? confirmationNote.trim() || undefined : undefined,
      });
      queryClient.setQueryData(queryKeys.orders.detail(result.order.id), result.order);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.orders.lists }),
        queryClient.invalidateQueries({ queryKey: queryKeys.stockBalances.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.stockTransactions.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.supplyStackOptions.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.inventoryDiscrepancies.all }),
      ]);
      setConfirmationMessage(
        describeConfirmation(result.confirmation, selectedConfirmReason?.name),
      );
      setConfirmationTarget(null);
    } catch (requestError) {
      if (getApiErrorCode(requestError) === ORDER_STATUS_UPDATE_WINDOW_EXPIRED) {
        setServerRefusedAsExpired(true);
      }
      setActionError(
        getApiErrorMessage(requestError, 'Không thể xác nhận số chồng.'),
      );
    }
  };

  const openPanel = (nextPanel: Exclude<ActionPanel, null>) => {
    setActionError(null);
    setIssueConflict(null);
    setPanel(nextPanel);
    if (nextPanel === "approve") {
      setItemValues(Object.fromEntries(items.map((item) => [item.id, {
        quantity: String(item.quantity_approved ?? item.quantity_requested),
      }])));
    }
    if (nextPanel === "issue") {
      setItemValues(Object.fromEntries(items.map((item) => [item.id, {
        quantity: "",
      }])));
    }
  };

  const confirmApprove = () => {
    if (!id) return;
    const approvals = items.map((item) => ({
      order_item_id: item.id,
      quantity_approved: Number(itemValues[item.id]?.quantity),
    }));
    // Zero rejects a line; above the request is allowed. The only ceiling is
    // what the source Area holds — the server checks the same rule.
    const invalid = approvals.some((approval) =>
      !Number.isInteger(approval.quantity_approved) || approval.quantity_approved < 0,
    );
    if (invalid) {
      setActionError("Số duyệt của mỗi dòng phải là số nguyên, không nhỏ hơn 0.");
      return;
    }
    // Lines of one code draw from one pooled row, so they are summed.
    const approvedByCode = new Map<string, { item: OrderItem; approved: number }>();
    items.forEach((item, index) => {
      const key = `${item.supply_id}:${item.provider_id}:${item.set_per_qty ?? 'normal'}`;
      const current = approvedByCode.get(key) ?? { item, approved: 0 };
      current.approved += approvals[index].quantity_approved;
      approvedByCode.set(key, current);
    });
    const overStock = [...approvedByCode.values()].find(
      ({ item, approved }) => approved > Number(item.available_quantity ?? 0),
    );
    if (overStock) {
      setActionError(
        `Số duyệt vượt tồn khu vực cấp: ${overStock.item.supply?.code ?? 'Vật tư'} duyệt ${overStock.approved}, tồn ${overStock.item.available_quantity ?? 0}.`,
      );
      return;
    }
    // A stack ships whole or not at all; the server refuses the rest too.
    const partialStack = items.find((item, index) =>
      item.set_per_qty !== null
      && approvals[index].quantity_approved % Number(item.set_per_qty) !== 0,
    );
    if (partialStack) {
      setActionError(
        `${partialStack.supply?.code ?? 'Kiện tiêu chuẩn'} phải duyệt theo bội số của ${partialStack.set_per_qty} SET/chồng.`,
      );
      return;
    }
    void runMutation(() => approveOrder(id, { items: approvals }));
  };

  const confirmIssue = () => {
    if (!id) return;
    if (stackItemsNotReady.length > 0) {
      setActionError("Còn vật tư kiện tiêu chuẩn chưa xác nhận số chồng.");
      return;
    }
    // A typed-but-fractional quantity must be reported, not silently skipped as
    // an empty row would be: supply is issued in whole units only.
    const hasFractionalQuantity = normalIssueItems.some((item) => {
      const quantity = Number(itemValues[item.id]?.quantity);
      return Number.isFinite(quantity) && !Number.isInteger(quantity);
    });
    if (hasFractionalQuantity) {
      setActionError("Số lượng cấp phải là số nguyên.");
      return;
    }
    const selected = normalIssueItems.flatMap((item) => {
      const quantity = Number(itemValues[item.id]?.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) return [];
      return [{ item, quantity }];
    });
    // Confirmed stack items ship on their own, so an issue with only those is valid.
    const pendingStack = stackItems.some((item) => {
      const state = stackStates.get(item.id);
      return state?.confirmation?.status === 'CONFIRMED';
    });
    if (selected.length === 0 && !pendingStack) {
      setActionError("Nhập ít nhất một số lượng cần cấp.");
      return;
    }
    if (selected.some(({ item, quantity }) => quantity > itemRemaining(item))) {
      setActionError("Số cấp không được vượt phần đã duyệt còn lại.");
      return;
    }
    void runMutation(() => issueOrder(id, {
      items: selected.map(({ item, quantity }) => ({
        order_item_id: item.id,
        quantity,
      })),
    }), true, (error) => {
      if (getApiErrorCode(error) === 'NORMAL_ISSUE_STOCK_CONFLICT') {
        setIssueConflict(getApiErrorDetails<NormalIssueStockConflictDetails>(error));
      }
    });
  };

  if (loading) {
    return <CardSkeleton lines={8} label="Đang tải chi tiết order" />;
  }
  if (loadError || !order || !id) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center">
        <p className="font-semibold text-rose-700">{loadError ?? "Không tìm thấy order."}</p>
        <Link to={ordersPath} className={`${TextButton} mt-3`}>Về danh sách</Link>
      </div>
    );
  }

  const hasActions = canCancel || canApprove
    || canConfirmAnyStack || hasIssueAction || canReceive || canComplete;
  const fromAreaName = order.from_area?.name ?? 'Không rõ';
  const toAreaName = order.to_area?.name ?? 'Không rõ';
  const stockShortageItems = items.filter((item) => item.has_stock_shortage && (
    item.set_per_qty === null
      ? Number(item.available_quantity ?? 0) > 0
      : Number(item.available_stack_quantity ?? 0) > 0
  ));
  const requesterName = order.requester
    ? `${order.requester.first_name} ${order.requester.last_name}`.trim()
    : 'Không rõ';
  const reviewRevisions = (order.order_revisions ?? []).filter(
    (revision) => revision.action?.code === 'APPROVE' || revision.action?.code === 'REJECT',
  );

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link to={ordersPath} className={TextButton}>← Danh sách order</Link>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">{order.code}</h1>
            <OrderStatusBadge status={order.status} />
          </div>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-800">
          Tạo, submit và approve không thay đổi tồn kho.<br />Chỉ thao tác issue mới trừ tồn và tạo transaction.
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[
          ["Area gửi", fromAreaName],
          ["Area nhận", toAreaName],
          ["Người tạo", requesterName],
          ["Ngày tạo", formatDate(order.created_at)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
            <p className="mt-2 break-words text-sm font-semibold text-slate-800">{value}</p>
          </div>
        ))}
      </div>

      {reviewRevisions.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-bold text-slate-900">Lịch sử duyệt / từ chối</h2>
          <div className="mt-3 space-y-2">
            {reviewRevisions.map((revision) => {
              const actorName = revision.creator
                ? `${revision.creator.first_name} ${revision.creator.last_name}`.trim()
                : 'Không rõ';
              return (
                <div
                  key={revision.id}
                  className="flex flex-col gap-1 rounded-xl bg-slate-50 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="font-semibold text-slate-800">
                    {revision.action?.name ?? revision.action?.code} — {actorName}
                  </span>
                  <span className="text-xs text-slate-500">
                    {formatDate(revision.created_at)}
                    {revision.reason ? ` — ${revision.reason}` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {stockShortageItems.length > 0 && (
        <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-bold">⚠ {stockShortageItems.length} vật tư đang có tồn thấp tại Area gửi.</p>
          <p className="mt-1">Đây là cảnh báo tại thời điểm kiểm tra. Order vẫn có thể được duyệt và chưa làm thay đổi tồn kho.</p>
        </div>
      )}

      {order.status === "APPROVED" && incompatibleStackItems.length > 0 && (
        <div role="alert" className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800">
          <p className="font-bold">Không thể xác nhận số chồng cho một số vật tư kiện tiêu chuẩn.</p>
          <p className="mt-1">
            Số lượng đã duyệt không chia hết cho quy cách SET/chồng ({incompatibleStackItems.map((item) => item.supply?.code ?? 'Vật tư').join(', ')}).
            Order này được duyệt trước khi hệ thống chặn trường hợp đó; cần hủy và tạo lại.
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Thao tác theo trạng thái và quyền</h2>
            <p className="mt-1 text-xs text-slate-500">Backend vẫn là lớp kiểm tra quyền cuối cùng.</p>
          </div>
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            {canApprove && <button type="button" title="Thao tác này chưa làm thay đổi tồn kho" disabled={actionsLocked} onClick={() => openPanel("approve")} className={ACTION_INFO}>Xác nhận</button>}
            {canApprove && <button type="button" title="Từ chối yêu cầu" disabled={actionsLocked} onClick={openRejectConfirmation} className={ACTION_ERROR}>Từ chối</button>}
            {hasIssueAction && (
              <button
                type="button"
                title={canIssue
                  ? "Issue mới trừ tồn và tạo StockTransactions"
                  : "Còn kiện tiêu chuẩn chưa xác nhận số chồng"}
                disabled={!canIssue || actionsLocked}
                onClick={() => openPanel("issue")}
                className={ACTION_VIOLET}
              >
                Xuất hàng
              </button>
            )}
            {canReceive && <button type="button" disabled={actionsLocked} onClick={() => void runMutation(() => receiveOrder(id))} className={ACTION_CYAN}>Đã nhận hàng</button>}
            {canComplete && <button type="button" disabled={actionsLocked} onClick={() => void runMutation(() => completeOrder(id))} className={ACTION_SUCCESS}>Hoàn thành</button>}
            {canCancel && <button type="button" disabled={actionsLocked} onClick={openCancelConfirmation} className={ACTION_SECONDARY}>Hủy order</button>}
          </div>
        </div>
        {isStatusUpdateExpired && (
          <div role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-bold">
              Đã quá thời hạn cho phép cập nhật trạng thái Order (kết thúc ca + 3 giờ).
            </p>
            <p className="mt-1">
              Không thể tiếp tục thao tác trên Order này.
              {statusUpdateCutoff && ` Hạn cuối: ${formatDate(statusUpdateCutoff.toISOString())}.`}
            </p>
          </div>
        )}
        {!hasActions && <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Không có thao tác phù hợp với role và trạng thái hiện tại.</p>}
        {mutating && <p className="mt-4 text-sm font-semibold text-blue-600">Đang cập nhật order...</p>}
        {actionError && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{actionError}</div>}
        {hasIssueAction && stackItemsNotReady.length > 0 && (
          <div role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-bold">Chưa sẵn sàng xuất kiện sắt tiêu chuẩn.</p>
            <p className="mt-1">
              Còn {stackItemsNotReady.length} dòng chưa xác nhận số chồng. Xác nhận ở bảng "Xác nhận số chồng" bên dưới; số xác nhận được xuất nguyên, không cần duyệt lại.
            </p>
          </div>
        )}
        {issueConflict && <NormalIssueConflictNotice details={issueConflict} />}
        {confirmationMessage && <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{confirmationMessage}</div>}
      </div>

      {panel === "approve" && (
        <ActionCard title="Duyệt số lượng" note="Số duyệt không nhỏ hơn 0 (0 = từ chối dòng đó) và không vượt tồn khu vực cấp; được duyệt nhiều hơn số yêu cầu. Kiện tiêu chuẩn duyệt theo bội số SET/chồng. Approve không trừ tồn.">
          <div className="space-y-3">
            {items.map((item) => (
              <QuantityRow key={item.id} item={item} label={item.set_per_qty !== null ? `Số SET duyệt (bội số ${item.set_per_qty})` : "Số lượng duyệt"} value={itemValues[item.id]?.quantity ?? ""} max={Number(item.available_quantity ?? 0)} onChange={(quantity) => setItemValues((current) => ({ ...current, [item.id]: { ...current[item.id], quantity } }))} />
            ))}
          </div>
          <PanelButtons disabled={mutating} onCancel={() => setPanel(null)} onConfirm={confirmApprove} confirmLabel="Xác nhận" />
        </ActionCard>
      )}

      {panel === "issue" && (
        <ActionCard title={`Cấp hàng từ ${fromAreaName}`} note="Tồn tính theo tổng của từng mã; vị trí chỉ để biết nơi lấy hàng. Issue là thao tác duy nhất trừ tồn và tạo StockTransactions.">
          {stackItems.length > 0 && (
            <div className="mb-4 space-y-3">
              {stackItems.map((item) => {
                const state = stackStates.get(item.id)!;
                const tone = state.issued || state.rejected
                  ? 'border-slate-200 bg-slate-50'
                  : state.ready
                    ? 'border-emerald-200 bg-emerald-50'
                    : 'border-amber-300 bg-amber-50';
                return (
                  <div key={item.id} className={`rounded-xl border p-4 ${tone}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-bold text-slate-900">{item.supply?.code ?? 'Vật tư'}</p>
                        <p className="mt-1 text-xs text-slate-600">{item.set_per_qty} SET/chồng · {locationCodes(item.locations)}</p>
                      </div>
                      <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-bold text-slate-700">
                        {state.rejected
                          ? 'Đã từ chối khi duyệt'
                          : state.issued
                            ? 'Đã xuất'
                            : state.ready
                              ? `Sẽ xuất ${state.confirmedStacks} chồng`
                              : 'Chưa xác nhận'}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                      <p>Đã duyệt: <strong>{state.approvedStacks ?? '—'} chồng</strong></p>
                      <p>Xác nhận: <strong>{state.confirmedStacks ?? '—'} chồng</strong></p>
                      <p>Lý do: <strong>{state.confirmation?.reason?.name ?? '—'}</strong></p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="space-y-3">
            {normalIssueItems.map((item) => (
              <div key={item.id} className="grid gap-3 rounded-xl border border-slate-200 p-3 md:grid-cols-[1fr_180px] md:items-center">
                <div className="text-sm">
                  <p className="font-semibold text-slate-800">{item.supply?.code ?? 'Vật tư'}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Còn được cấp: {itemRemaining(item)} · Tồn: {item.available_quantity} · Lấy tại: {locationCodes(item.locations)}
                  </p>
                </div>
                <input type="number" min="1" step="1" max={itemRemaining(item)} value={itemValues[item.id]?.quantity ?? ""} onChange={(event) => setItemValues((current) => ({ ...current, [item.id]: { ...current[item.id], quantity: event.target.value } }))} placeholder="Số lượng cấp" aria-label={`Số lượng cấp ${item.supply?.code ?? ''}`} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
            ))}
          </div>
          <PanelButtons
            disabled={mutating || stackItemsNotReady.length > 0}
            onCancel={() => setPanel(null)}
            onConfirm={confirmIssue}
            confirmLabel="Xác nhận"
          />
        </ActionCard>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div><h2 className="font-bold text-slate-900">Order items</h2><p className="mt-1 text-xs text-slate-500">{items.length} dòng vật tư</p></div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Items đã khóa</span>
        </div>
        {items.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">Order chưa có item.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Vật tư</th><th className="px-5 py-3">Provider</th><th className="px-5 py-3">Yêu cầu</th><th className="px-5 py-3">Tồn khả dụng</th><th className="px-5 py-3">Đã duyệt</th><th className="px-5 py-3">Đã cấp</th><th className="px-5 py-3">Ghi chú</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.id} className={item.has_stock_shortage ? "bg-amber-50/70" : undefined}>
                    <td className="px-5 py-4 font-mono text-xs text-slate-700">{item.supply?.code ?? '—'}</td>
                    <td className="px-5 py-4"><p className="font-semibold text-slate-800">{item.provider?.code ?? '—'}</p><p className="text-xs text-slate-500">{item.provider?.name ?? '—'}</p></td>
                    <td className="px-5 py-4">
                      {item.set_per_qty !== null ? (
                        <div>
                          <p className="font-semibold text-slate-800">{item.set_per_qty} SET/chồng</p>
                          <p className="text-xs text-slate-500">
                            {item.requested_stack_quantity} chồng — {item.requested_total_set_quantity} SET
                          </p>
                          {item.available_stack_quantity !== undefined && (
                            <p className="text-xs text-slate-500">Tồn: {item.available_stack_quantity} chồng cùng quy cách</p>
                          )}
                        </div>
                      ) : item.quantity_requested}
                    </td>
                    <td className="px-5 py-4"><StockAvailabilityWarning item={item} compact /></td>
                    <td className="px-5 py-4">
                      {item.quantity_approved ?? "—"}
                      {item.set_per_qty !== null && item.quantity_approved !== null && (
                        <p className="text-xs text-slate-500">
                          {approvedStackQuantity(item) === null
                            ? "Không tương thích quy cách"
                            : `${approvedStackQuantity(item)} chồng`}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <p>{item.quantity_issued ?? 0} SET</p>
                      {item.set_per_qty !== null && stackStates.get(item.id)?.confirmedStacks !== null && (
                        <p className="text-xs text-slate-500">
                          {stackStates.get(item.id)?.confirmedStacks} chồng đã xác nhận
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-4">{item.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showStackSection && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="font-bold text-slate-900">Xác nhận số chồng — kiện tiêu chuẩn</h2>
            <p className="mt-1 text-xs text-slate-500">
              Số xác nhận có thể ít hoặc nhiều hơn số duyệt (kèm lý do) và được xuất nguyên, không cần duyệt lại. Xác nhận chưa trừ tồn; chỉ Xuất hàng mới trừ.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Vật tư</th>
                  <th className="px-5 py-3">Provider</th>
                  <th className="px-5 py-3">Quy cách</th>
                  <th className="px-5 py-3">Lấy tại</th>
                  <th className="px-5 py-3">Duyệt</th>
                  <th className="px-5 py-3">Xác nhận</th>
                  <th className="px-5 py-3">Trạng thái</th>
                  <th className="px-5 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stackItems.map((item) => {
                  const state = stackStates.get(item.id)!;
                  const confirmation = state.confirmation;
                  return (
                    <tr key={item.id}>
                      <td className="px-5 py-4 font-semibold text-slate-800">{item.supply?.code ?? "—"}</td>
                      <td className="px-5 py-4">
                        <p className="font-semibold text-slate-800">{item.provider?.code ?? "—"}</p>
                        <p className="text-xs text-slate-500">{item.provider?.name ?? "—"}</p>
                      </td>
                      <td className="px-5 py-4">{item.set_per_qty} SET/chồng</td>
                      <td className="px-5 py-4 text-xs font-semibold text-slate-700">{locationCodes(item.locations)}</td>
                      <td className="px-5 py-4 font-semibold">{state.approvedStacks ?? '—'} chồng</td>
                      <td className="px-5 py-4">
                        <p className="font-semibold">{state.confirmedStacks ?? "—"}{state.confirmedStacks !== null && ' chồng'}</p>
                        {confirmation?.reason && (
                          <p className="text-xs text-slate-600">{confirmation.reason.name}</p>
                        )}
                        {confirmation?.reason_note && (
                          <p className="text-xs italic text-slate-500">{confirmation.reason_note}</p>
                        )}
                        {(confirmation?.discrepancies ?? []).map((discrepancy) => (
                          <span key={discrepancy.id} title={discrepancy.reason ?? undefined} className={`mt-1 mr-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${discrepancy.status === 'OPEN' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>
                            {discrepancy.status === 'OPEN'
                              ? (discrepancy.source === 'ISSUE' ? 'Tồn sổ thiếu — cần kiểm kê' : 'Không có hàng — cần kiểm kê')
                              : 'Đã kiểm kê'}
                          </span>
                        ))}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${state.issued ? 'bg-slate-100 text-slate-700' : state.ready ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
                          {state.rejected ? 'Từ chối khi duyệt' : state.issued ? 'Đã xuất' : state.ready ? 'Đã xác nhận' : 'Chưa xác nhận'}
                        </span>
                        {confirmation?.confirmed_at && (
                          <p className="mt-1 text-xs text-slate-500">{formatDate(confirmation.confirmed_at)}</p>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right">
                        {canConfirmItem(item) ? (
                          <button
                            type="button"
                            disabled={mutating || isStatusUpdateExpired}
                            onClick={() => openConfirmation(item)}
                            className={InfoButton}
                          >
                            Xác nhận số chồng
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(order.note || order.rejected_reason || order.cancel_reason) && (
        <div className="grid gap-3 md:grid-cols-3">
          {order.note && <InfoNote label="Ghi chú" value={order.note} />}
          {order.rejected_reason && <InfoNote label="Lý do từ chối" value={order.rejected_reason} />}
          {order.cancel_reason && <InfoNote label="Lý do hủy" value={order.cancel_reason} />}
        </div>
      )}
      {confirmationTarget && (
        <CrudModal
          title="Xác nhận số chồng"
          busy={confirmationMutation.isPending}
          onClose={() => setConfirmationTarget(null)}
        >
          <div className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
            <ReadOnlyValue label="Vật tư" value={confirmationTarget.supply?.code ?? '—'} />
            <ReadOnlyValue label="Provider" value={confirmationTarget.provider ? `${confirmationTarget.provider.code} — ${confirmationTarget.provider.name}` : '—'} />
            <ReadOnlyValue label="Lấy tại" value={locationCodes(confirmationTarget.locations)} />
            <ReadOnlyValue label="Quy cách" value={`${confirmationTarget.set_per_qty ?? '—'} SET/chồng`} />
            <ReadOnlyValue label="Đã duyệt" value={`${confirmTargetApproved ?? '—'} chồng`} />
            <ReadOnlyValue label="Tồn sổ" value={`${confirmationTarget.available_stack_quantity ?? 0} chồng`} />
          </div>
          <div className="mt-4 space-y-4">
            <label className={labelClassName}>
              <span>Số chồng xác nhận *</span>
              <input
                type="number"
                min="0"
                step="1"
                value={actualStackQuantity}
                onChange={(event) => {
                  setActualStackQuantity(event.target.value);
                  // A reason for "fewer" means nothing once the count is "more".
                  setConfirmationReasonCode('');
                }}
                className={inputClassName}
              />
              {!confirmActualValid && actualStackQuantity.trim() !== '' && (
                <FieldError message="Số chồng phải là số nguyên lớn hơn hoặc bằng 0." />
              )}
              <span className="text-xs font-normal text-slate-500">
                Có thể ít hơn hoặc nhiều hơn số đã duyệt khi hai bên đã thống nhất. Số này được xuất nguyên.
              </span>
            </label>
            {confirmDirection && (
              <>
                <label className={labelClassName}>
                  <span>Lý do {confirmDirection === 'LOWER' ? 'nhận ít hơn' : 'nhận thêm'} *</span>
                  {confirmReasonsQuery.isPending ? (
                    <p className="text-sm text-slate-500">Đang tải lý do…</p>
                  ) : confirmReasonsQuery.isError ? (
                    <FieldError message={getApiErrorMessage(confirmReasonsQuery.error, 'Không thể tải danh sách lý do.')} />
                  ) : (
                    <select
                      value={confirmationReasonCode}
                      onChange={(event) => setConfirmationReasonCode(event.target.value)}
                      className={inputClassName}
                    >
                      <option value="">Chọn lý do</option>
                      {confirmReasonOptions.map((reason) => (
                        <option key={reason.id} value={reason.code}>{reason.name}</option>
                      ))}
                    </select>
                  )}
                  {selectedConfirmReason?.description && (
                    <span className={`text-xs font-normal ${selectedConfirmReason.corrects_stock ? 'text-amber-700' : 'text-slate-500'}`}>
                      {selectedConfirmReason.description}
                    </span>
                  )}
                </label>
                <label className={labelClassName}>
                  <span>Ghi chú (không bắt buộc)</span>
                  <textarea
                    rows={3}
                    maxLength={2000}
                    value={confirmationNote}
                    onChange={(event) => setConfirmationNote(event.target.value)}
                    className={inputClassName}
                    placeholder="Ví dụ: đã trao đổi với tổ trưởng đóng gói"
                  />
                </label>
              </>
            )}
          </div>
          <PanelButtons
            disabled={
              confirmationMutation.isPending
              || !confirmActualValid
              || (confirmDirection !== null && !selectedConfirmReason)
            }
            onCancel={() => setConfirmationTarget(null)}
            onConfirm={() => void submitStackConfirmation()}
            confirmLabel="Xác nhận"
          />
        </CrudModal>
      )}
    </section>
  );
};

const ActionCard = ({ title, note, children }: { title: string; note: string; children: React.ReactNode }) => (
  <div className="rounded-2xl border border-blue-200 bg-white p-5 shadow-sm">
    <h2 className="font-bold text-slate-900">{title}</h2><p className="mt-1 text-sm text-slate-500">{note}</p><div className="mt-4">{children}</div>
  </div>
);

const ReadOnlyValue = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 text-sm font-semibold text-slate-800">{value}</p>
  </div>
);

const PanelButtons = ({ disabled, onCancel, onConfirm, confirmLabel, danger = false }: { disabled: boolean; onCancel: () => void; onConfirm: () => void; confirmLabel: string; danger?: boolean }) => (
  <div className="mt-4 flex justify-end gap-2"><button type="button" disabled={disabled} onClick={onConfirm} className={danger ? ErrorButton : InfoButton}>{confirmLabel}</button><button type="button" disabled={disabled} onClick={onCancel} className={SecondaryButton}>Bỏ qua</button></div>
);

const QuantityRow = ({ item, label, value, max, onChange }: { item: OrderItem; label: string; value: string; max: number; onChange: (value: string) => void }) => (
  <div className={`grid gap-3 rounded-xl border p-3 text-sm md:grid-cols-[1fr_180px] md:items-center ${item.has_stock_shortage ? "border-amber-300 bg-amber-50/70" : "border-slate-200"}`}><div><strong className="block text-slate-800">{item.supply?.code ?? 'Vật tư'}</strong><span className="text-xs text-slate-500">Yêu cầu: {item.quantity_requested}</span><div className="mt-2"><StockAvailabilityWarning item={item} /></div></div><label><span className="mb-1 block text-xs font-semibold text-slate-500">{label}</span><input type="number" min="0" max={max} step="1" value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" /></label></div>
);

/**
 * Normal supplies still refuse to issue past the books. (Stack items never land
 * here: a short book ships anyway and opens a recount.)
 */
const NormalIssueConflictNotice = ({
  details,
}: {
  details: NormalIssueStockConflictDetails;
}) => (
  <div className="mt-3 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
    <p className="font-bold">Không đủ tồn để cấp {details.supply_code ?? "vật tư"}{details.provider_code ? ` (${details.provider_code})` : ""}.</p>
    <dl className="mt-3 grid gap-2 sm:grid-cols-3">
      <div><dt className="text-xs text-rose-700">Cần cấp</dt><dd className="font-semibold">{details.required_quantity ?? "—"}</dd></div>
      <div><dt className="text-xs text-rose-700">Tồn hiện tại</dt><dd className="font-semibold">{details.current_quantity ?? "—"}</dd></div>
      <div><dt className="text-xs text-rose-700">Thiếu</dt><dd className="font-semibold">{details.shortage_quantity ?? "—"}</dd></div>
    </dl>
  </div>
);

const InfoNote = ({ label, value }: { label: string; value: string }) => <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-2 text-sm text-slate-700">{value}</p></div>;

export default OrderDetailPage;
