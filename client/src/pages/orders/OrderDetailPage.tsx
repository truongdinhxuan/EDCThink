import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRef, useCallback, useMemo, useState, type MouseEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  getApiErrorCode,
  getApiErrorDetails,
  getApiErrorMessage,
  ORDER_STATUS_UPDATE_WINDOW_EXPIRED,
} from "../../api/errors";
import { listStorageLocations } from "../../api/storage-locations.service";
import {
  approveOrder,
  allocateOrder,
  cancelOrder,
  completeOrder,
  confirmOrderAllocation,
  getOrder,
  issueOrder,
  receiveOrder,
  rejectOrder,
} from "../../api/orders.service";
import {
  CyanButton,
  ErrorButton,
  InfoButton,
  SecondaryButton,
  SuccessButton,
  TextButton,
  VioletButton,
} from "../../components/common/Button";
import { CardSkeleton, SelectSkeleton } from "../../components/common/skeleton";
import { OrderStatusBadge } from "../../components/orders/OrderStatusBadge";
import { StockAvailabilityWarning } from "../../components/orders/StockAvailabilityWarning";
import { CrudModal, FieldError, inputClassName, labelClassName } from "../../components/crud/CrudPrimitives";
import { PERMISSION_CODE } from "../../constants/permissions";
import { getWorkspacePath } from "../../constants/workspaces";
import { useAuth } from "../../context/AuthContext";
import { useServerLookup } from "../../hooks/useServerLookup";
import { useCrudOffcanvas } from "../../hooks/useCrudOffcanvas";
import { useDeadlinePassed } from "../../hooks/useDeadlinePassed";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { queryKeys } from "../../lib/queryKeys";
import { resolveStatusUpdateCutoff } from "../../utils/workShiftWindow";
import type { StorageLocationOption } from "../../types/catalog";
import type {
  Order,
  OrderItem,
  OrderItemAllocation,
  StackAllocationErrorDetails,
  StackIssueStockConflictDetails,
} from "../../types/orders";

type ActionPanel = "approve" | "issue" | null;
type ItemValues = Record<string, { quantity: string; note?: string; storageLocationId?: string }>;

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

interface StackIssueReadiness {
  approvedStacks: number | null;
  actualConfirmedStacks: number;
  unconfirmedAllocations: number;
  remainingStacks: number;
  isAlreadyIssued: boolean;
  ready: boolean;
}

const getStackIssueReadiness = (item: OrderItem): StackIssueReadiness => {
  const approvedStacks = approvedStackQuantity(item);
  const allocations = item.allocations ?? [];
  const unconfirmedAllocations = allocations.filter(
    (allocation) => allocation.actual_stack_quantity === null || !allocation.confirmed_at,
  ).length;
  const actualConfirmedStacks = allocations.reduce(
    (total, allocation) => total + Number(allocation.actual_stack_quantity ?? 0),
    0,
  );
  const isAlreadyIssued = item.quantity_approved !== null
    && Number(item.quantity_issued ?? 0) === Number(item.quantity_approved);
  const remainingStacks = approvedStacks === null
    ? 0
    : Math.max(0, approvedStacks - actualConfirmedStacks);

  return {
    approvedStacks,
    actualConfirmedStacks,
    unconfirmedAllocations,
    remainingStacks,
    isAlreadyIssued,
    ready: isAlreadyIssued || (
      approvedStacks !== null
      && allocations.length > 0
      && unconfirmedAllocations === 0
      && actualConfirmedStacks === approvedStacks
    ),
  };
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
      allocationId,
      actualStackQuantity,
      reason: confirmationReason,
    }: {
      allocationId: string;
      actualStackQuantity: number;
      reason?: string;
    }) => confirmOrderAllocation(id!, allocationId, {
      actual_stack_quantity: actualStackQuantity,
      reason: confirmationReason,
    }),
  });
  const order = orderQuery.data ?? null;
  const loading = orderQuery.isPending;
  const loadError = orderQuery.isError
    ? getApiErrorMessage(orderQuery.error, "Không thể tải order.")
    : null;
  const [actionError, setActionError] = useState<string | null>(null);
  const [allocationErrorDetails, setAllocationErrorDetails] =
    useState<StackAllocationErrorDetails | null>(null);
  const [stackIssueErrorDetails, setStackIssueErrorDetails] =
    useState<StackIssueStockConflictDetails | null>(null);
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
  const [confirmationTarget, setConfirmationTarget] = useState<{
    item: OrderItem;
    allocation: OrderItemAllocation;
  } | null>(null);
  const [actualStackQuantity, setActualStackQuantity] = useState('');
  const [confirmationReason, setConfirmationReason] = useState('');
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null);
  const storageLocationLoader = useCallback(
    (search: string | undefined, signal: AbortSignal) => {
      if (!order) throw new Error("Order chưa sẵn sàng.");
      return listStorageLocations({
        page: 1,
        pageSize: 20,
        search,
        areaId: order.from_area_id,
        isActive: true,
        sortBy: 'code',
        sortOrder: 'asc',
      }, signal);
    },
    [order],
  );
  const storageLocationLookup = useServerLookup<StorageLocationOption>({
    loader: storageLocationLoader,
    queryKey: (search) => queryKeys.storageLocations.lookup({
      search,
      areaId: order?.from_area_id,
      pageSize: 20,
      isActive: true,
    }),
    errorMessage: "Không thể tải danh sách vị trí kho.",
    enabled: panel === "issue" && Boolean(
      order?.order_items?.some(
        (item) => item.set_per_qty === null && itemRemaining(item) > 0,
      ),
    ),
  });
  const storageLocations = storageLocationLookup.items;
  const storageLocationsLoading = storageLocationLookup.loading;
  const storageLocationsError = storageLocationLookup.error;
  const storageLocationSearch = storageLocationLookup.search;
  const setStorageLocationSearch = storageLocationLookup.setSearch;

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
  const isAllocator = hasPermission(PERMISSION_CODE.SUPPLY_ORDER_ALLOCATE);
  const canConfirmAllocations = hasPermission(
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
  const stackReadiness = useMemo(
    () => new Map(stackItems.map((item) => [item.id, getStackIssueReadiness(item)])),
    [stackItems],
  );
  const stackItemsNotReady = useMemo(
    () => stackItems.filter((item) => !stackReadiness.get(item.id)?.ready),
    [stackItems, stackReadiness],
  );
  const incompatibleStackItems = useMemo(
    () => stackItems.filter((item) => approvedStackQuantity(item) === null),
    [stackItems],
  );
  const hasInitialAllocations = stackItems.some(
    (item) => (item.allocations?.length ?? 0) > 0,
  );
  const canCancel = Boolean(order && isPackingOwner && order.status === "PENDING");
  const canApprove = Boolean(order && isApprover && order.status === "PENDING");
  const canAllocate = Boolean(
    order &&
    isAllocator &&
    order.status === "APPROVED" &&
    stackItems.length > 0 &&
    incompatibleStackItems.length === 0 &&
    !hasInitialAllocations
  );
  const hasIssueAction = Boolean(
    order && isIssuer && ["APPROVED", "PARTIAL_ISSUED"].includes(order.status),
  );
  const canIssue = hasIssueAction && stackItemsNotReady.length === 0;
  const canReceive = Boolean(order && isPackingOwner && order.status === "ISSUED");
  const canComplete = Boolean(order && isIssuer && ["ISSUED", "RECEIVED"].includes(order.status));
  const stackAllocationRows = useMemo(
    () => stackItems.flatMap((item) =>
      (item.allocations ?? []).map((allocation) => ({ item, allocation })),
    ),
    [stackItems],
  );
  const canConfirmAnyAllocation = Boolean(
    order?.status === 'APPROVED'
    && canConfirmAllocations
    && stackAllocationRows.some(({ allocation }) =>
      allocation.actual_stack_quantity === null && allocation.confirmed_at === null),
  );

  const runMutation = async (
    operation: () => Promise<Order>,
    affectsStock = false,
    onError?: (error: unknown) => void,
    throwOnError = false,
  ) => {
    setActionError(null);
    setAllocationErrorDetails(null);
    setStackIssueErrorDetails(null);
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

  const openConfirmation = (
    item: OrderItem,
    allocation: OrderItemAllocation,
  ) => {
    setActionError(null);
    setConfirmationMessage(null);
    setConfirmationTarget({ item, allocation });
    setActualStackQuantity(String(allocation.expected_stack_quantity));
    setConfirmationReason('');
  };

  const confirmActualAllocation = async () => {
    if (!id || !confirmationTarget) return;
    const actual = Number(actualStackQuantity);
    if (!Number.isFinite(actual) || actual < 0) {
      setActionError('Số chồng thực tế phải lớn hơn hoặc bằng 0.');
      return;
    }
    if (!Number.isInteger(actual)) {
      setActionError('Số chồng phải là số nguyên.');
      return;
    }
    if (actual > confirmationTarget.allocation.expected_stack_quantity) {
      setActionError('Số chồng thực tế không được vượt số chồng dự kiến.');
      return;
    }

    setActionError(null);
    try {
      const result = await confirmationMutation.mutateAsync({
        allocationId: confirmationTarget.allocation.id,
        actualStackQuantity: actual,
        reason: confirmationReason.trim() || undefined,
      });
      queryClient.setQueryData(queryKeys.orders.detail(result.order.id), result.order);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.orders.lists }),
        queryClient.invalidateQueries({ queryKey: queryKeys.stockBalances.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.stockTransactions.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.supplyStackOptions.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.inventoryDiscrepancies.all }),
      ]);
      const confirmation = result.confirmation;
      setConfirmationMessage(
        confirmation.reallocation_status === 'INSUFFICIENT'
          ? `Đã ghi nhận chênh lệch ${confirmation.difference_stack_quantity} chồng. Không đủ tồn thay thế; còn thiếu ${confirmation.unallocated_stack_quantity} chồng.`
          : confirmation.reallocation_status === 'REALLOCATED'
            ? `Đã ghi nhận chênh lệch và tạo ${confirmation.reallocation_count ?? confirmation.new_allocations.length} allocation thay thế.`
            : 'Đã xác nhận đúng số chồng dự kiến.',
      );
      setConfirmationTarget(null);
    } catch (requestError) {
      setActionError(
        getApiErrorMessage(requestError, 'Không thể xác nhận số chồng thực tế.'),
      );
    }
  };

  const openPanel = (nextPanel: Exclude<ActionPanel, null>) => {
    setActionError(null);
    setStackIssueErrorDetails(null);
    setPanel(nextPanel);
    if (nextPanel === "approve") {
      setItemValues(Object.fromEntries(items.map((item) => [item.id, {
        quantity: String(item.quantity_approved ?? item.quantity_requested),
      }])));
    }
    if (nextPanel === "issue") {
      setItemValues(Object.fromEntries(items.map((item) => [item.id, {
        quantity: "",
        storageLocationId: "",
      }])));
    }
  };

  const openIssuePanel = () => {
    if (!order) return;
    openPanel("issue");
    setStorageLocationSearch("");
  };

  const confirmApprove = () => {
    if (!id) return;
    const approvals = items.map((item) => ({
      order_item_id: item.id,
      quantity_approved: Number(itemValues[item.id]?.quantity),
    }));
    const invalid = approvals.some((approval, index) =>
      !Number.isInteger(approval.quantity_approved) ||
      approval.quantity_approved <= 0 ||
      approval.quantity_approved > Number(items[index].quantity_requested),
    );
    if (invalid) {
      setActionError("Số duyệt của mỗi dòng phải là số nguyên lớn hơn 0 và không vượt số lượng yêu cầu.");
      return;
    }
    void runMutation(() => approveOrder(id, { items: approvals }));
  };

  const confirmIssue = () => {
    if (!id) return;
    if (stackItemsNotReady.length > 0) {
      setActionError("Chưa xác nhận đầy đủ số chồng thực tế trước khi xuất hàng.");
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
      const values = itemValues[item.id];
      const quantity = Number(values?.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) return [];
      return [{ item, quantity, storageLocationId: values?.storageLocationId?.trim() ?? "" }];
    });
    if (selected.length === 0 && stackItems.length === 0) {
      setActionError("Nhập ít nhất một số lượng cần cấp.");
      return;
    }
    if (selected.length > 0 && storageLocationsLoading) {
      setActionError("Danh sách vị trí kho vẫn đang tải.");
      return;
    }
    if (selected.length > 0 && (storageLocationsError || storageLocations.length === 0)) {
      setActionError("Danh sách vị trí kho chưa sẵn sàng. Không thể issue hàng.");
      return;
    }
    if (selected.some(({ item, quantity, storageLocationId }) =>
      !storageLocations.some((location) => location.id === storageLocationId) ||
      quantity > itemRemaining(item),
    )) {
      setActionError("Cần chọn vị trí kho hợp lệ và số cấp không được vượt phần đã duyệt còn lại.");
      return;
    }
    void runMutation(() => issueOrder(id, {
      items: selected.map(({ item, quantity, storageLocationId }) => ({
        order_item_id: item.id,
        issues: [{ storage_location_id: storageLocationId, quantity }],
      })),
    }), true, (error) => {
      if (getApiErrorCode(error) === 'STACK_ISSUE_STOCK_CONFLICT') {
        setStackIssueErrorDetails(
          getApiErrorDetails<StackIssueStockConflictDetails>(error),
        );
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

  const hasActions = canCancel || canApprove || canAllocate
    || canConfirmAnyAllocation || hasIssueAction || canReceive || canComplete;
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
          <p className="font-bold">Không thể phân bổ vị trí cho một số vật tư chồng.</p>
          <p className="mt-1">
            Số lượng đã duyệt phải chia hết cho quy cách SET/chồng. Cần điều chỉnh bước duyệt trước khi phân bổ.
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-slate-900">Thao tác theo trạng thái và quyền</h2>
            <p className="mt-1 text-xs text-slate-500">Backend vẫn là lớp kiểm tra quyền cuối cùng.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canApprove && <button type="button" title="Thao tác này chưa làm thay đổi tồn kho" disabled={actionsLocked} onClick={() => openPanel("approve")} className={InfoButton}>Xác nhận</button>}
            {canApprove && <button type="button" title="Từ chối yêu cầu" disabled={actionsLocked} onClick={openRejectConfirmation} className={ErrorButton}>Từ chối</button>}
            {canAllocate && <button type="button" title="Tạo đề xuất vị trí; không trừ hoặc giữ tồn kho" disabled={actionsLocked} onClick={() => void runMutation(() => allocateOrder(id), false, (error) => setAllocationErrorDetails(getApiErrorDetails<StackAllocationErrorDetails>(error)))} className={InfoButton}>Phân bổ vị trí</button>}
            {hasIssueAction && (
              <button
                type="button"
                title={canIssue
                  ? "Issue mới trừ tồn và tạo StockTransactions"
                  : "Chưa xác nhận đủ số chồng thực tế"}
                disabled={!canIssue || actionsLocked}
                onClick={openIssuePanel}
                className={VioletButton}
              >
                Xuất hàng
              </button>
            )}
            {canReceive && <button type="button" disabled={actionsLocked} onClick={() => void runMutation(() => receiveOrder(id))} className={CyanButton}>Đã nhận hàng</button>}
            {canComplete && <button type="button" disabled={actionsLocked} onClick={() => void runMutation(() => completeOrder(id))} className={SuccessButton}>Hoàn thành</button>}
            {canCancel && <button type="button" disabled={actionsLocked} onClick={openCancelConfirmation} className={SecondaryButton}>Hủy order</button>}
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
            <p className="mt-1">Chưa xác nhận đầy đủ số chồng thực tế hoặc tổng đã xác nhận chưa bằng số chồng được duyệt.</p>
          </div>
        )}
        {stackIssueErrorDetails && (
          <StackIssueConflictDetails details={stackIssueErrorDetails} />
        )}
        {confirmationMessage && <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{confirmationMessage}</div>}
        {allocationErrorDetails && (
          <AllocationErrorDetails details={allocationErrorDetails} items={items} />
        )}
      </div>

      {panel === "approve" && (
        <ActionCard title="Duyệt số lượng" note="Mỗi dòng phải duyệt lớn hơn 0 và không vượt số yêu cầu. Tồn thấp chỉ cảnh báo; approve không trừ tồn.">
          <div className="space-y-3">
            {items.map((item) => (
              <QuantityRow key={item.id} item={item} label="Số lượng duyệt" value={itemValues[item.id]?.quantity ?? ""} max={item.quantity_requested} onChange={(quantity) => setItemValues((current) => ({ ...current, [item.id]: { ...current[item.id], quantity } }))} />
            ))}
          </div>
          <PanelButtons disabled={mutating} onCancel={() => setPanel(null)} onConfirm={confirmApprove} confirmLabel="Xác nhận" />
        </ActionCard>
      )}

      {panel === "issue" && (
        <ActionCard title={`Cấp hàng từ ${fromAreaName}`} note="Chỉ được chọn vị trí kho thuộc Area gửi. Issue là thao tác duy nhất trừ StockBalances và tạo StockTransactions.">
          {stackItems.length > 0 && (
            <div className="mb-4 space-y-3">
              {stackItems.map((item) => {
                const readiness = stackReadiness.get(item.id)!;
                return (
                  <div key={item.id} className={`rounded-xl border p-4 ${readiness.ready ? 'border-emerald-200 bg-emerald-50' : 'border-amber-300 bg-amber-50'}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-bold text-slate-900">{item.supply?.code ?? 'Vật tư'}</p>
                        <p className="mt-1 text-xs text-slate-600">{item.set_per_qty} SET/chồng</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${readiness.ready ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                        {readiness.isAlreadyIssued ? 'Đã xuất đủ' : readiness.ready ? 'Sẵn sàng xuất' : 'Chưa sẵn sàng'}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                      <p>Đã duyệt: <strong>{readiness.approvedStacks ?? 'Không tương thích'} chồng</strong></p>
                      <p>Đã xác nhận: <strong>{readiness.actualConfirmedStacks} chồng</strong></p>
                      <p>Còn thiếu: <strong>{readiness.remainingStacks} chồng</strong></p>
                    </div>
                    {!readiness.ready && (
                      <p className="mt-2 text-xs font-semibold text-amber-800">
                        {readiness.unconfirmedAllocations > 0
                          ? `Còn ${readiness.unconfirmedAllocations} allocation chưa xác nhận thực tế.`
                          : 'Tổng số chồng thực tế chưa bằng số chồng được duyệt.'}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {normalIssueItems.length > 0 && (
            <>
              <input type="search" value={storageLocationSearch} onChange={(event) => setStorageLocationSearch(event.target.value)} placeholder={`Tìm vị trí kho thuộc ${fromAreaName}...`} className="mb-4 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
              {storageLocationsError && (
                <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  {storageLocationsError}
                </div>
              )}
              {!storageLocationsLoading && !storageLocationsError && storageLocations.length === 0 && (
                <div className="mb-4 rounded-xl border border-dashed border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                  Không có vị trí kho active trong Area gửi {fromAreaName}.
                </div>
              )}
            </>
          )}
          <div className="space-y-3">
            {normalIssueItems.map((item) => (
              <div key={item.id} className="grid gap-3 rounded-xl border border-slate-200 p-3 md:grid-cols-[1fr_1fr_1fr]">
                <div className="text-sm"><p className="font-semibold text-slate-800">{item.supply?.code ?? 'Vật tư'}</p><p className="mt-1 text-xs text-slate-500">Còn được cấp: {itemRemaining(item)}</p></div>
                {storageLocationsLoading && storageLocations.length === 0 ? (
                  <SelectSkeleton label="Đang tải vị trí kho của Area gửi" />
                ) : (
                  <select
                    value={itemValues[item.id]?.storageLocationId ?? ""}
                    onChange={(event) => setItemValues((current) => ({ ...current, [item.id]: { ...current[item.id], storageLocationId: event.target.value } }))}
                    disabled={Boolean(storageLocationsError) || storageLocations.length === 0}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100"
                  >
                    <option value="">
                      {storageLocationsError
                        ? "Không thể tải vị trí"
                        : storageLocations.length === 0
                          ? "Không có vị trí active"
                          : "Chọn vị trí kho"}
                    </option>
                    {storageLocations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.code}{location.name ? ` — ${location.name}` : ""}
                      </option>
                    ))}
                  </select>
                )}
                <input type="number" min="1" step="1" max={itemRemaining(item)} value={itemValues[item.id]?.quantity ?? ""} onChange={(event) => setItemValues((current) => ({ ...current, [item.id]: { ...current[item.id], quantity: event.target.value } }))} placeholder="Số lượng cấp" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
            ))}
          </div>
          <PanelButtons
            disabled={
              mutating
              || stackItemsNotReady.length > 0
              || (normalIssueItems.length > 0 && (
                storageLocationsLoading
                || Boolean(storageLocationsError)
                || storageLocations.length === 0
              ))
            }
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
                      {item.set_per_qty !== null && (
                        <p className="text-xs text-slate-500">
                          {getStackIssueReadiness(item).actualConfirmedStacks} chồng thực tế đã xác nhận
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

      {stackAllocationRows.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="font-bold text-slate-900">Đề xuất phân bổ vị trí</h2>
            <p className="mt-1 text-xs text-slate-500">
              Đây là đề xuất lấy hàng ban đầu; chưa trừ tồn, chưa giữ tồn và chưa ghi StockTransactions.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Vật tư</th>
                  <th className="px-5 py-3">Provider</th>
                  <th className="px-5 py-3">Quy cách</th>
                  <th className="px-5 py-3">Vị trí</th>
                  <th className="px-5 py-3">Chồng dự kiến</th>
                  <th className="px-5 py-3">Chồng thực tế</th>
                  <th className="px-5 py-3">Trạng thái</th>
                  <th className="px-5 py-3">Thời điểm</th>
                  <th className="px-5 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stackAllocationRows.map(({ item, allocation }) => (
                  <tr key={allocation.id}>
                    <td className="px-5 py-4 font-semibold text-slate-800">
                      {item.supply?.code ?? "—"}
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-semibold text-slate-800">{item.provider?.code ?? "—"}</p>
                      <p className="text-xs text-slate-500">{item.provider?.name ?? "—"}</p>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${allocation.confirmed_at ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                        {allocation.confirmed_at ? 'Đã xác nhận' : 'Chưa xác nhận'}
                      </span>
                    </td>
                    <td className="px-5 py-4">{item.set_per_qty} SET/chồng</td>
                    <td className="px-5 py-4">
                      <p className="font-semibold text-slate-800">{allocation.location?.code ?? "—"}</p>
                      <p className="text-xs text-slate-500">{allocation.location?.name ?? "—"}</p>
                    </td>
                    <td className="px-5 py-4 font-semibold">{allocation.expected_stack_quantity}</td>
                    <td className="px-5 py-4">
                      <p>{allocation.actual_stack_quantity ?? "—"}</p>
                      {(allocation.discrepancies ?? []).map((discrepancy) => (
                        <span key={discrepancy.id} className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${discrepancy.status === 'OPEN' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>
                          {discrepancy.status === 'OPEN' ? 'Cần kiểm kê' : 'Đã xử lý'}
                        </span>
                      ))}
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-500">{formatDate(allocation.allocated_at)}</td>
                    <td className="px-5 py-4 text-right">
                      {order.status === 'APPROVED'
                        && canConfirmAllocations
                        && allocation.actual_stack_quantity === null
                        && allocation.confirmed_at === null ? (
                          <button
                            type="button"
                            disabled={mutating}
                            onClick={() => openConfirmation(item, allocation)}
                            className={InfoButton}
                          >
                            Xác nhận thực tế
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">
                            {allocation.confirmed_at ? 'Đã xác nhận' : '—'}
                          </span>
                        )}
                    </td>
                  </tr>
                ))}
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
          title="Xác nhận số chồng thực tế"
          busy={confirmationMutation.isPending}
          onClose={() => setConfirmationTarget(null)}
        >
          <div className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
            <ReadOnlyValue label="Vật tư" value={confirmationTarget.item.supply?.code ?? '—'} />
            <ReadOnlyValue label="Provider" value={confirmationTarget.item.provider ? `${confirmationTarget.item.provider.code} — ${confirmationTarget.item.provider.name}` : '—'} />
            <ReadOnlyValue label="Vị trí" value={confirmationTarget.allocation.location ? `${confirmationTarget.allocation.location.code} — ${confirmationTarget.allocation.location.name}` : '—'} />
            <ReadOnlyValue label="Quy cách" value={`${confirmationTarget.item.set_per_qty ?? '—'} SET/chồng`} />
            <ReadOnlyValue label="Dự kiến" value={`${confirmationTarget.allocation.expected_stack_quantity} chồng`} />
          </div>
          <div className="mt-4 space-y-4">
            <label className={labelClassName}>
              <span>Số chồng thực tế *</span>
              <input
                type="number"
                min="0"
                max={confirmationTarget.allocation.expected_stack_quantity}
                step="1"
                value={actualStackQuantity}
                onChange={(event) => setActualStackQuantity(event.target.value)}
                className={inputClassName}
              />
              {Number(actualStackQuantity) > confirmationTarget.allocation.expected_stack_quantity && (
                <FieldError message="Không được vượt số chồng dự kiến." />
              )}
            </label>
            <label className={labelClassName}>
              <span>Lý do sai lệch (không bắt buộc)</span>
              <textarea
                rows={3}
                maxLength={2000}
                value={confirmationReason}
                onChange={(event) => setConfirmationReason(event.target.value)}
                className={inputClassName}
                placeholder="Nhập lý do nếu số thực tế thấp hơn dự kiến"
              />
            </label>
          </div>
          <PanelButtons
            disabled={confirmationMutation.isPending}
            onCancel={() => setConfirmationTarget(null)}
            onConfirm={() => void confirmActualAllocation()}
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

const AllocationErrorDetails = ({
  details,
  items,
}: {
  details: StackAllocationErrorDetails;
  items: OrderItem[];
}) => {
  const item = items.find((candidate) => candidate.id === details.order_item_id);
  const supplyLabel = details.supply_code ?? item?.supply?.code ?? "Vật tư chồng";
  const hasAvailabilityDetails =
    details.required_stack_quantity !== undefined &&
    details.available_stack_quantity !== undefined &&
    details.shortage_stack_quantity !== undefined;

  return (
    <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-bold">Chi tiết phân bổ: {supplyLabel}</p>
      {hasAvailabilityDetails ? (
        <dl className="mt-3 grid gap-2 sm:grid-cols-4">
          <div><dt className="text-xs text-amber-700">Cần</dt><dd className="font-semibold">{details.required_stack_quantity} chồng</dd></div>
          <div><dt className="text-xs text-amber-700">Hiện có</dt><dd className="font-semibold">{details.available_stack_quantity} chồng</dd></div>
          <div><dt className="text-xs text-amber-700">Thiếu</dt><dd className="font-semibold">{details.shortage_stack_quantity} chồng</dd></div>
          <div><dt className="text-xs text-amber-700">Quy cách</dt><dd className="font-semibold">{details.set_per_qty ?? "—"} SET/chồng</dd></div>
        </dl>
      ) : (
        <p className="mt-2">
          Số duyệt: {details.quantity_approved ?? "—"}; quy cách: {details.set_per_qty ?? "—"} SET/chồng.
        </p>
      )}
    </div>
  );
};

const StackIssueConflictDetails = ({
  details,
}: {
  details: StackIssueStockConflictDetails;
}) => (
  <div className="mt-3 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
    <p className="font-bold">Không đủ tồn thực tế tại vị trí đã xác nhận.</p>
    <dl className="mt-3 grid gap-2 sm:grid-cols-5">
      <div><dt className="text-xs text-rose-700">Vị trí</dt><dd className="font-semibold">{details.location_code ?? "—"}</dd></div>
      <div><dt className="text-xs text-rose-700">Quy cách</dt><dd className="font-semibold">{details.set_per_qty ?? "—"} SET/chồng</dd></div>
      <div><dt className="text-xs text-rose-700">Cần xuất</dt><dd className="font-semibold">{details.required_stack_quantity ?? "—"} chồng</dd></div>
      <div><dt className="text-xs text-rose-700">Tồn hiện tại</dt><dd className="font-semibold">{details.current_stack_quantity ?? "—"} chồng</dd></div>
      <div><dt className="text-xs text-rose-700">Thiếu</dt><dd className="font-semibold">{details.shortage_stack_quantity ?? "—"} chồng</dd></div>
    </dl>
  </div>
);

const InfoNote = ({ label, value }: { label: string; value: string }) => <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-2 text-sm text-slate-700">{value}</p></div>;

export default OrderDetailPage;
