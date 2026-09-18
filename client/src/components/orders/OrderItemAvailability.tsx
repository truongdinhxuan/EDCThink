import { useQuery } from '@tanstack/react-query';
import { getSupplyAvailability } from '../../api/supplies.service';
import { queryKeys } from '../../lib/queryKeys';

interface OrderItemAvailabilityProps {
  supplyId: string;
  providerId: string;
  areaId: string;
  quantityRequested?: number;
  enabled?: boolean;
}

const quantityFormatter = new Intl.NumberFormat('vi-VN', {
  maximumFractionDigits: 0,
});

/**
 * Non-blocking pre-submit stock hint for normal (non-stack) OrderItems.
 * KIEN_SAT_TC rows already surface availability through OrderStackFields.
 * The authoritative zero-stock check still runs server-side on submit.
 */
export const OrderItemAvailability = ({
  supplyId,
  providerId,
  areaId,
  quantityRequested,
  enabled = true,
}: OrderItemAvailabilityProps) => {
  const ready = Boolean(supplyId && providerId && areaId && enabled);
  const availabilityQuery = useQuery({
    queryKey: queryKeys.supplyAvailability.list(supplyId, providerId, areaId),
    queryFn: ({ signal }) => getSupplyAvailability(
      supplyId,
      { provider_id: providerId, area_id: areaId },
      signal,
    ),
    enabled: ready,
    staleTime: 10_000,
  });

  if (!ready) return null;

  if (availabilityQuery.isPending) {
    return (
      <span className="mt-1 block text-xs font-normal normal-case text-slate-400">
        Đang kiểm tra tồn khả dụng…
      </span>
    );
  }

  if (availabilityQuery.isError) {
    return (
      <span className="mt-1 block text-xs font-normal normal-case text-slate-400">
        Chưa kiểm tra được tồn khả dụng. Tồn sẽ được kiểm lại khi gửi Order.
      </span>
    );
  }

  const available = availabilityQuery.data.available_quantity;
  const requested = Number(quantityRequested) || 0;
  const shortage = Math.max(0, requested - available);

  if (available <= 0) {
    return (
      <span className="mt-1 block text-xs font-medium normal-case text-rose-600">
        Hết tồn tại khu vực cấp. Order sẽ bị từ chối khi gửi.
      </span>
    );
  }

  if (shortage > 0) {
    return (
      <span className="mt-1 block text-xs font-medium normal-case text-amber-700">
        Tồn khả dụng {quantityFormatter.format(available)} — thiếu {quantityFormatter.format(shortage)}.
        Order vẫn có thể gửi; tồn được kiểm lại khi cấp hàng.
      </span>
    );
  }

  return (
    <span className="mt-1 block text-xs font-medium normal-case text-emerald-700">
      Tồn khả dụng: {quantityFormatter.format(available)}
    </span>
  );
};
