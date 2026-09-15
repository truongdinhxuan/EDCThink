import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { getApiErrorMessage } from '../../api/errors';
import { getShiftOrderSheet } from '../../api/shift-order-sheets.service';
import { TextButton } from '../../components/common/Button';
import { CardSkeleton } from '../../components/common/skeleton';
import { ShiftOrderSheetWorkspace } from '../../components/orders/ShiftOrderSheetWorkspace';
import { getWorkspacePath } from '../../constants/workspaces';
import { useAuth } from '../../context/AuthContext';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { queryKeys } from '../../lib/queryKeys';

const ShiftOrderSheetDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const { role } = useAuth();
  const listPath = getWorkspacePath(role, 'shift-order-sheets');
  const query = useQuery({
    queryKey: queryKeys.shiftOrderSheets.detail(id ?? ''),
    queryFn: ({ signal }) => getShiftOrderSheet(id!, signal),
    enabled: Boolean(id),
  });

  // Called before the early returns below so the hook order never changes.
  // Undefined until the Sheet loads, so the tab shows the app name rather than
  // a placeholder that is about to be replaced.
  useDocumentTitle(query.data?.area && query.data.work_shift
    ? `Phiếu order ca ${query.data.work_shift.code} · ${query.data.area.code}`
    : undefined);

  if (query.isPending) return <CardSkeleton lines={8} label="Đang tải Phiếu Order Ca" />;
  if (query.isError || !query.data) return (
    <section className="space-y-4">
      <Link to={listPath} className={TextButton}>← Phiếu Order Ca hiện tại</Link>
      <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-700">
        {getApiErrorMessage(query.error, 'Không thể tải Phiếu Order Ca.')}
      </div>
    </section>
  );

  const sheet = query.data;
  if (!sheet.area || !sheet.work_shift) {
    return (
      <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-800">
        Phiếu Order Ca thiếu Area hoặc ca làm việc hợp lệ.
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <Link to={listPath} className={TextButton}>← Phiếu Order Ca hiện tại</Link>
      <ShiftOrderSheetWorkspace
        mode="detail"
        sheet={sheet}
        context={{
          id: sheet.id,
          area_id: sheet.area_id,
          work_shift_id: sheet.work_shift_id,
          work_date: sheet.work_date,
          area: sheet.area,
          work_shift: sheet.work_shift,
          leader: sheet.leader,
        }}
      />
    </section>
  );
};

export default ShiftOrderSheetDetailPage;
