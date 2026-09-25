import { useState } from "react";
import type { OrderItem } from "../../types/orders";
import { getButtonClassName } from "../common/Button";

interface StockAvailabilityWarningProps {
  item: OrderItem;
  compact?: boolean;
  /** md for the enlarged Order items card; sm everywhere else. */
  textSize?: 'sm' | 'md';
}

const quantityFormatter = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 0,
});

export const StockAvailabilityWarning = ({
  item,
  compact = false,
  textSize = 'sm',
}: StockAvailabilityWarningProps) => {
  const [open, setOpen] = useState(false);
  const text = textSize === 'md' ? 'text-sm' : 'text-xs';

  if (!item.has_stock_shortage) {
    return (
      <span className={`inline-flex rounded-full bg-emerald-50 px-2.5 py-1 ${text} font-semibold text-emerald-700`}>
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
          size: textSize === 'md' ? "sm" : "xs",
          className: "rounded-full font-bold",
        })}
      >
        <span aria-hidden="true">⚠</span>
        Tồn thấp
      </button>
      {open && (
        <div className={`rounded-lg border border-amber-200 bg-amber-50 p-2 ${text} leading-5 text-amber-900`}>
          <p className="text-5xl">Yêu cầu: {quantityFormatter.format(item.quantity_requested)}</p>
          <p className="text-5xl">Tồn khả dụng: {quantityFormatter.format(item.available_quantity)}</p>
          <p className="text-5xl">Thiếu: {quantityFormatter.format(item.shortage_quantity)}</p>
          <p className="mt-1 font-medium">Order vẫn có thể được tạo/gửi hoặc approve. Tồn sẽ được kiểm tra lại khi issue.</p>
        </div>
      )}
    </div>
  );
};
