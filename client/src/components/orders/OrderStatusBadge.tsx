import type { OrderStatus } from "../../types/orders";

const STATUS_STYLE: Record<OrderStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-blue-100 text-blue-800",
  REJECTED: "bg-rose-100 text-rose-800",
  PARTIAL_ISSUED: "bg-violet-100 text-violet-800",
  ISSUED: "bg-indigo-100 text-indigo-800",
  RECEIVED: "bg-cyan-100 text-cyan-800",
  COMPLETED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-slate-200 text-slate-700",
};

export const OrderStatusBadge = ({ status }: { status: OrderStatus }) => (
  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_STYLE[status]}`}>
    {status.replaceAll("_", " ")}
  </span>
);
