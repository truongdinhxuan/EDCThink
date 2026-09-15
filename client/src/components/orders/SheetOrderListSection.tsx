import { Link } from 'react-router-dom';
import { getWorkspacePath } from '../../constants/workspaces';
import { useAuth } from '../../context/AuthContext';
import type { OrderStatus } from '../../types/orders';
import type { ShiftOrderSheetOrder } from '../../types/shift-order-sheets';
import { InfoButton, TextButton } from '../common/Button';
import { OrderStatusBadge } from './OrderStatusBadge';

const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const formatDateTime = (value: string | null | undefined): string => value
  ? new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: BUSINESS_TIME_ZONE,
  }).format(new Date(value))
  : '—';

const requesterName = (order: ShiftOrderSheetOrder): string => order.requester
  ? `${order.requester.first_name} ${order.requester.last_name}`.trim()
  : 'Không xác định';

interface SheetOrderListSectionProps {
  orders: ShiftOrderSheetOrder[];
}

/**
 * Step two of the approver flow: every Order raised on one market's Sheet.
 *
 * The Sheet's business key is (area_id, work_shift_id, work_date), so the Orders
 * already carried by the loaded Sheet are exactly the market/shift/day slice the
 * approver drilled into. Re-querying by those three values would only fetch the
 * same rows again, so this renders what the Sheet already holds.
 */
export const SheetOrderListSection = ({ orders }: SheetOrderListSectionProps) => {
  const { role } = useAuth();
  const ordersPath = getWorkspacePath(role, 'orders');

  const pendingCount = orders.filter(
    (order) => (order.status_lookup?.code ?? order.status) === 'PENDING',
  ).length;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <h2 className="font-bold text-slate-900">Order trong phiếu</h2>
          <p className="mt-1 text-sm text-slate-500">
            {orders.length} Order
            {pendingCount > 0 && ` · ${pendingCount} chờ duyệt`}
          </p>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="px-4 py-10 text-center sm:px-6">
          <p className="text-sm font-semibold text-slate-700">Phiếu này chưa có Order.</p>
        </div>
      ) : (
        <>
          {/* Mobile: dense stacked rows, same rhythm as the other Sheet lists. */}
          <ul className="divide-y divide-slate-100 md:hidden">
            {orders.map((order) => {
              const status = (order.status_lookup?.code ?? order.status) as OrderStatus;
              return (
                <li key={order.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{order.code}</p>
                    <p className="truncate text-xs text-slate-500">{requesterName(order)}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {order.order_items.length} mã · {formatDateTime(order.submitted_at ?? order.created_at)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <OrderStatusBadge status={status} />
                    <p className="mt-1">
                      <Link to={`${ordersPath}/${order.id}`} className={TextButton}>
                        Xem order
                      </Link>
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2">Mã order</th>
                  <th scope="col" className="px-3 py-2">Trạng thái</th>
                  <th scope="col" className="px-3 py-2">Số mã</th>
                  <th scope="col" className="hidden px-3 py-2 lg:table-cell">Người tạo</th>
                  <th scope="col" className="hidden px-3 py-2 lg:table-cell">Thời gian</th>
                  <th scope="col" className="px-3 py-2 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((order) => {
                  const status = (order.status_lookup?.code ?? order.status) as OrderStatus;
                  const pending = status === 'PENDING';
                  return (
                    <tr key={order.id} className="hover:bg-slate-50/80">
                      <td className="px-3 py-2.5 font-semibold text-slate-900">{order.code}</td>
                      <td className="px-3 py-2.5"><OrderStatusBadge status={status} /></td>
                      <td className="px-3 py-2.5 tabular-nums">{order.order_items.length}</td>
                      <td className="hidden px-3 py-2.5 lg:table-cell">{requesterName(order)}</td>
                      <td className="hidden whitespace-nowrap px-3 py-2.5 lg:table-cell">
                        {formatDateTime(order.submitted_at ?? order.created_at)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {/* An Order still awaiting a decision is the one the
                            approver came here to act on, so it gets the primary. */}
                        <Link
                          to={`${ordersPath}/${order.id}`}
                          className={pending ? `${InfoButton} min-h-9` : TextButton}
                        >
                          Xem order
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
