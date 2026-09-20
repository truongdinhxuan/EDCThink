import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getApiErrorMessage } from '../../api/errors';
import { listIncomingShiftOrderSheets } from '../../api/shift-order-sheets.service';
import { getWorkspacePath, SHIFT_ORDER_SHEET_PATH } from '../../constants/workspaces';
import { useAuth } from '../../context/AuthContext';
import { queryKeys } from '../../lib/queryKeys';
import type {
  IncomingShiftOrderSheet,
  ShiftOrderSheetCreateContext,
} from '../../types/shift-order-sheets';
import { TextButton } from '../common/Button';
import { ErrorState } from '../crud/CrudPrimitives';

const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const formatDate = (value: string): string => new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: BUSINESS_TIME_ZONE,
}).format(new Date(`${value}T00:00:00+07:00`));

const shiftName = (context: ShiftOrderSheetCreateContext): string =>
  context.work_shift?.name || context.work_shift?.code || 'không xác định';

const leaderName = (sheet: IncomingShiftOrderSheet): string => sheet.leader
  ? `${sheet.leader.first_name} ${sheet.leader.last_name}`.trim()
  : '—';

const PendingBadge = ({ count }: { count: number }) => count > 0 ? (
  <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
    {count} chờ duyệt
  </span>
) : (
  <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
    Đã xử lý
  </span>
);

interface IncomingMarketOrdersSectionProps {
  context: ShiftOrderSheetCreateContext;
}

/**
 * Sheets raised by the markets that order out of this approver's Area, for the
 * exact shift instance in `context`. A Sheet from another date or another shift
 * is an older Sheet and deliberately stays out of this list; it remains
 * reachable through "Lịch sử phiếu order ca".
 *
 * Which Areas appear is decided entirely server side from the caller's token,
 * so no area filter is passed from the client.
 */
export const IncomingMarketOrdersSection = ({
  context,
}: IncomingMarketOrdersSectionProps) => {
  const { role } = useAuth();
  const sheetsPath = getWorkspacePath(role, SHIFT_ORDER_SHEET_PATH);
  const params = {
    workDate: context.work_date,
    workShiftId: context.work_shift_id,
  };

  const incomingQuery = useQuery({
    queryKey: queryKeys.shiftOrderSheets.incoming(params),
    queryFn: ({ signal }) => listIncomingShiftOrderSheets(params, signal),
    enabled: Boolean(context.work_date && context.work_shift_id),
    staleTime: 30 * 1000,
  });

  const sheets = incomingQuery.data ?? [];
  const totalPending = sheets.reduce((sum, sheet) => sum + sheet.pending_order_count, 0);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <h2 className="font-bold text-slate-900">Phiếu order từ các thị trường</h2>
          <p className="mt-1 text-sm text-slate-500">
            Ca {shiftName(context)} · {formatDate(context.work_date)}
            {sheets.length > 0 && ` · ${sheets.length} thị trường`}
          </p>
        </div>
        {totalPending > 0 && <PendingBadge count={totalPending} />}
      </div>

      {incomingQuery.isPending ? (
        <div className="space-y-2 px-4 py-4 sm:px-5" aria-busy="true">
          <span className="sr-only">Đang tải phiếu order từ các thị trường</span>
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-10 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      ) : incomingQuery.isError ? (
        <div className="px-4 py-5 sm:px-5">
          <ErrorState
            message={getApiErrorMessage(
              incomingQuery.error,
              'Không thể tải phiếu order từ các thị trường.',
            )}
            onRetry={() => void incomingQuery.refetch()}
          />
        </div>
      ) : sheets.length === 0 ? (
        <div className="px-4 py-10 text-center sm:px-6">
          <p className="text-sm font-semibold text-slate-700">
            Chưa có thị trường nào order trong ca này.
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Phiếu của ca trước nằm trong “Lịch sử phiếu order ca”.
          </p>
        </div>
      ) : (
        <>
          {/* Mobile: dense stacked rows, same rhythm as the material list above. */}
          <ul className="divide-y divide-slate-100 md:hidden">
            {sheets.map((sheet) => (
              <li key={sheet.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">
                    {sheet.area?.code ?? '—'}
                  </p>
                  <p className="truncate text-xs text-slate-500">{sheet.area?.name ?? '—'}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {sheet.order_count} Order · {sheet.item_count} mã
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <PendingBadge count={sheet.pending_order_count} />
                  <p className="mt-1">
                    <Link to={`${sheetsPath}/${sheet.id}`} className={TextButton}>
                      Xem phiếu
                    </Link>
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2">Thị trường</th>
                  <th scope="col" className="px-3 py-2">Số Order</th>
                  <th scope="col" className="px-3 py-2">Số mã</th>
                  <th scope="col" className="px-3 py-2">Chờ duyệt</th>
                  <th scope="col" className="hidden px-3 py-2 lg:table-cell">Tổ trưởng</th>
                  <th scope="col" className="px-3 py-2 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sheets.map((sheet) => (
                  <tr key={sheet.id} className="hover:bg-slate-50/80">
                    <td className="px-3 py-2.5">
                      <span className="font-semibold text-slate-900">{sheet.area?.code ?? '—'}</span>
                      <span className="ml-2 text-slate-500">{sheet.area?.name ?? ''}</span>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{sheet.order_count}</td>
                    <td className="px-3 py-2.5 tabular-nums">{sheet.item_count}</td>
                    <td className="px-3 py-2.5"><PendingBadge count={sheet.pending_order_count} /></td>
                    <td className="hidden px-3 py-2.5 lg:table-cell">{leaderName(sheet)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Link to={`${sheetsPath}/${sheet.id}`} className={TextButton}>
                        Xem phiếu
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
