import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getApiErrorMessage } from '../../api/errors';
import { getCurrentShiftOrderSheet } from '../../api/shift-order-sheets.service';
import { SecondaryButton } from '../../components/common/Button';
import { CardSkeleton } from '../../components/common/skeleton';
import { ShiftOrderSheetWorkspace } from '../../components/orders/ShiftOrderSheetWorkspace';
import { getWorkspacePath, SHIFT_ORDER_SHEET_HISTORY_PATH } from '../../constants/workspaces';
import { useAuth } from '../../context/AuthContext';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { queryKeys } from '../../lib/queryKeys';

/**
 * The Sheet for the shift the user is working right now.
 *
 * There is exactly one of those, resolved server-side from the user's Area and
 * the clock, so this screen has nothing to search, filter or paginate — the
 * filter rail that used to sit beside it belonged to the archive, which is now
 * its own route at {@link SHIFT_ORDER_SHEET_HISTORY_PATH}.
 */
const ShiftOrderSheetsPage = () => {
  useDocumentTitle('Phiếu order ca');
  const { user, role } = useAuth();
  const assignedAreaId = user?.publicData.area_id ?? '';
  const historyPath = getWorkspacePath(role, SHIFT_ORDER_SHEET_HISTORY_PATH);

  const currentQuery = useQuery({
    queryKey: queryKeys.shiftOrderSheets.current,
    queryFn: ({ signal }) => getCurrentShiftOrderSheet(signal),
    enabled: Boolean(assignedAreaId),
  });

  // Without an Area there is no "current" shift to resolve, but the Area Type
  // Scope may still grant access to other Areas' Sheets, so the archive stays
  // offered rather than the screen dead-ending.
  if (!assignedAreaId) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">Phiếu order ca</h1>
        <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-800">
          <p className="font-semibold">Bạn chưa được gán khu vực làm việc hiện tại.</p>
          <p className="mt-1 text-sm">Bạn vẫn có thể xem các Phiếu Order Ca trong Area Type Scope được cấp.</p>
        </div>
        <Link to={historyPath} className={SecondaryButton}>
          Xem lịch sử phiếu order ca
        </Link>
      </section>
    );
  }

  if (currentQuery.isPending) {
    return <CardSkeleton lines={9} label="Đang tải Phiếu Order Ca hiện tại" />;
  }

  if (currentQuery.isError || !currentQuery.data) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">Phiếu order ca</h1>
        <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-800">
          {getApiErrorMessage(currentQuery.error, 'Không thể xác định Phiếu Order Ca hiện tại.')}
        </div>
        <Link to={historyPath} className={SecondaryButton}>
          Xem lịch sử phiếu order ca
        </Link>
      </section>
    );
  }

  const { context, sheet } = currentQuery.data;
  return (
    <ShiftOrderSheetWorkspace
      mode="current"
      sheet={sheet}
      context={{
        id: sheet?.id ?? null,
        area_id: context.area_id,
        work_shift_id: context.work_shift_id,
        work_date: context.work_date,
        area: context.area,
        work_shift: context.work_shift,
        leader: sheet?.leader ?? null,
        shift_start_at: context.shift_start_at,
        shift_end_at: context.shift_end_at,
        is_outside_working_hours: context.is_outside_working_hours,
      }}
      historyPath={historyPath}
    />
  );
};

export default ShiftOrderSheetsPage;
