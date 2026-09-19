import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getShiftOrderSheet } from '../../api/shift-order-sheets.service';
import { TextButton } from '../../components/common/Button';
import { CardSkeleton } from '../../components/common/skeleton';
import { CreateOrderForm } from '../../components/orders/CreateOrderForm';
import { getWorkspacePath } from '../../constants/workspaces';
import { useAuth } from '../../context/AuthContext';
import { queryKeys } from '../../lib/queryKeys';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

const LEGACY_CREATE_FORM_ID = 'create-order-page-form';

const CreateOrderPage = () => {
  useDocumentTitle('Tạo order');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { role } = useAuth();
  const ordersPath = getWorkspacePath(role, 'orders');
  const shiftOrderSheetId = searchParams.get('shiftOrderSheetId') ?? '';
  const shiftSheetQuery = useQuery({
    queryKey: queryKeys.shiftOrderSheets.detail(shiftOrderSheetId),
    queryFn: ({ signal }) => getShiftOrderSheet(shiftOrderSheetId, signal),
    enabled: Boolean(shiftOrderSheetId),
  });

  if (shiftOrderSheetId && shiftSheetQuery.isPending) {
    return <CardSkeleton lines={6} label="Đang kiểm tra Phiếu Order Ca" />;
  }

  return (
    <section className="space-y-5">
      <div>
        <Link to={ordersPath} className={TextButton}>← Danh sách order</Link>
        <h1 className="mt-3 text-2xl font-bold text-slate-900">Tạo order</h1>
        <p className="mt-1 text-sm text-slate-500">Order được gửi trực tiếp ở trạng thái PENDING và chưa làm thay đổi tồn kho.</p>
      </div>

      {shiftOrderSheetId && (shiftSheetQuery.isError || !shiftSheetQuery.data) ? (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm font-semibold text-rose-700">
          Không thể xác thực Phiếu Order Ca. Không nên tiếp tục tạo Order từ context này.
        </div>
      ) : (
        <CreateOrderForm
          formId={LEGACY_CREATE_FORM_ID}
          sheetContext={shiftSheetQuery.data ?? null}
          showInlineActions
          onCancel={() => navigate(ordersPath)}
          onSuccess={async (order) => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.orders.lists }).catch(() => undefined);
            navigate(`${ordersPath}/${order.id}${shiftOrderSheetId ? `?shiftOrderSheetId=${shiftOrderSheetId}` : ''}`);
          }}
        />
      )}
    </section>
  );
};

export default CreateOrderPage;
