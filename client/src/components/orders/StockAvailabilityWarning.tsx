import { useState } from "react";
import type { OrderItem } from "../../types/orders";
import { getButtonClassName } from "../common/Button";

interface StockAvailabilityWarningProps {
  item: OrderItem;
  compact?: boolean;
}

const quantityFormatter = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 0,
});

export const StockAvailabilityWarning = ({
  item,
  compact = false,
}: StockAvailabilityWarningProps) => {
  const [open, setOpen] = useState(false);

  if (!item.has_stock_shortage) {
    return (
      <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
        Tồn: {quantityFormatter.format(item.available_quantity)}
      </span>
    );
  }

  return (
    <div className={compact ? "inline-block" : "space-y-2"}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={getButtonClassName({
          variant: "warning",
          size: "xs",
          className: "rounded-full font-bold",
        })}
      >
        <span aria-hidden="true">⚠</span>
        Tồn thấp
      </button>
      {open && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs leading-5 text-amber-900">
          <p>Yêu cầu: {quantityFormatter.format(item.quantity_requested)}</p>
          <p>Tồn khả dụng: {quantityFormatter.format(item.available_quantity)}</p>
          <p>Thiếu: {quantityFormatter.format(item.shortage_quantity)}</p>
          <p className="mt-1 font-medium">Order vẫn có thể được tạo/gửi hoặc approve. Tồn sẽ được kiểm tra lại khi issue.</p>
        </div>
      )}
    </div>
  );
};
