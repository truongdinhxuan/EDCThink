import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { getApiErrorMessage } from '../../api/errors';
import {
  listTeamsDeliveries,
  listTeamsWorkflows,
  retryTeamsDelivery,
  saveTeamsWorkflow,
  sendTeamsWorkflowTest,
} from '../../api/teams-workflows.service';
import { getButtonClassName } from '../../components/common/Button';
import { DataTable, type Column } from '../../components/common/DataTable';
import { CardSkeleton } from '../../components/common/skeleton';
import {
  CrudFeedbackToast,
  CrudPageHeader,
  ErrorState,
  inputClassName,
  labelClassName,
} from '../../components/crud/CrudPrimitives';
import { PERMISSION_CODE } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { useDebounce } from '../../hooks/useDebounce';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import type { CrudFeedback } from '../../hooks/useCrudResource';
import { queryKeys } from '../../lib/queryKeys';
import type {
  TeamsDelivery,
  TeamsDeliveryListParams,
  TeamsDeliveryStatus,
  TeamsWorkflow,
} from '../../types/teams-workflows';

const dateTimeFormatter = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'medium' });
const formatDateTime = (value: string | null) => (value ? dateTimeFormatter.format(new Date(value)) : '—');

const STATUS_LABEL: Record<TeamsDeliveryStatus, string> = {
  PENDING: 'Đang chờ',
  SENT: 'Đã gửi',
  FAILED: 'Thất bại',
};
const STATUS_TONE: Record<TeamsDeliveryStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  SENT: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-rose-100 text-rose-700',
};

const StatusBadge = ({ status }: { status: TeamsDeliveryStatus }) => (
  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[status]}`}>
    {STATUS_LABEL[status]}
  </span>
);

const deliveryResult = (delivery: TeamsDelivery) => {
  if (delivery.last_http_status !== null) return `HTTP ${delivery.last_http_status}`;
  return delivery.status === 'PENDING' ? 'Chưa gửi' : '—';
};

/**
 * A switch that is a real checkbox underneath, so it keeps native keyboard
 * and form behaviour.
 */
const Toggle = ({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) => (
  <label className={`inline-flex items-center gap-2 text-sm font-semibold ${disabled ? 'cursor-not-allowed text-slate-400' : 'cursor-pointer text-slate-700'}`}>
    <input
      type="checkbox"
      role="switch"
      className="peer sr-only"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
    <span
      aria-hidden="true"
      className="relative h-5 w-9 rounded-full bg-slate-300 transition peer-checked:bg-stone-800 peer-focus-visible:ring-2 peer-focus-visible:ring-stone-500 peer-focus-visible:ring-offset-2 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4"
    />
    {label}
  </label>
);

const WorkflowCard = ({
  workflow,
  canManage,
  onFeedback,
}: {
  workflow: TeamsWorkflow;
  canManage: boolean;
  onFeedback: (feedback: CrudFeedback) => void;
}) => {
  const queryClient = useQueryClient();
  const [isActive, setIsActive] = useState(workflow.is_active);
  const dirty = isActive !== workflow.is_active;
  const urlReady = workflow.has_url && workflow.url_allowed;
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.teamsWorkflows.all });

  const saveMutation = useMutation({
    mutationFn: () => saveTeamsWorkflow(workflow.function_code, { is_active: isActive }),
    onSuccess: async (saved) => {
      setIsActive(saved.is_active);
      onFeedback({ type: 'success', message: 'Đã lưu cấu hình Workflow.' });
      await refresh();
    },
    onError: (error) => onFeedback({ type: 'error', message: getApiErrorMessage(error, 'Không lưu được cấu hình.') }),
  });
  const testMutation = useMutation({
    mutationFn: () => sendTeamsWorkflowTest(workflow.function_code),
    onSuccess: async (result) => {
      onFeedback(result.ok
        ? { type: 'success', message: `Đã gửi tin thử (HTTP ${result.http_status}).` }
        : { type: 'error', message: `Gửi thử thất bại: ${result.error ?? `HTTP ${result.http_status}`}.` });
      await refresh();
    },
    onError: (error) => onFeedback({ type: 'error', message: getApiErrorMessage(error, 'Không gửi được tin thử.') }),
  });
  const busy = saveMutation.isPending || testMutation.isPending;
  const last = workflow.last_delivery;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-900">{workflow.function_name}</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            <span className="font-mono">{workflow.function_code}</span> · {workflow.description}
          </p>
        </div>
        <Toggle
          checked={isActive}
          // Turning on needs a usable URL; turning off is always allowed.
          disabled={!canManage || busy || (!isActive && !urlReady)}
          onChange={setIsActive}
          label={isActive ? 'Đang bật' : 'Đang tắt'}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
        <div className="space-y-3">
          {/* The URL is a server secret kept in .env; this page only shows
              which variable to set and a masked view of what is set. */}
          <div className={labelClassName}>
            <span>URL Workflow (cấu hình trong .env của server)</span>
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 sm:text-sm">
              {workflow.url_env_key}={workflow.has_url ? workflow.masked_url : '…'}
            </p>
            <span className={`block text-xs font-normal ${urlReady ? 'text-slate-500' : 'text-rose-600'}`}>
              {!workflow.has_url
                ? `Chưa khai báo. Thêm ${workflow.url_env_key}=<HTTP POST URL của Workflow> vào server/.env rồi khởi động lại server.`
                : !workflow.url_allowed
                  ? 'URL không hợp lệ: phải là https tới host trong TEAMS_WEBHOOK_ALLOWED_HOSTS.'
                  : 'Đổi URL: sửa server/.env rồi khởi động lại server.'}
            </span>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || !dirty}
                onClick={() => saveMutation.mutate()}
                className={getButtonClassName({ variant: 'info', size: 'sm' })}
              >
                {saveMutation.isPending ? 'Đang lưu…' : 'Lưu'}
              </button>
              <button
                type="button"
                disabled={busy || !urlReady || dirty}
                title={dirty ? 'Lưu thay đổi trước khi gửi thử' : undefined}
                onClick={() => testMutation.mutate()}
                className={getButtonClassName({ variant: 'secondary', size: 'sm' })}
              >
                {testMutation.isPending ? 'Đang gửi…' : 'Gửi thử'}
              </button>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Lần gửi gần nhất</p>
          {last ? (
            <div className="mt-1.5 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={last.status} />
                <span className="font-semibold text-slate-700">{deliveryResult(last)}</span>
              </div>
              <p className="text-xs text-slate-600">
                {last.is_test ? 'Tin gửi thử' : `${last.order_code ?? 'Đơn'} · ${last.order_status ?? ''}`}
              </p>
              <p className="text-xs text-slate-500">{formatDateTime(last.sent_at ?? last.updated_at)}</p>
              {last.last_error && last.status !== 'SENT' && (
                <p className="text-xs text-rose-600">{last.last_error}</p>
              )}
            </div>
          ) : (
            <p className="mt-1.5 text-xs text-slate-500">Chưa có lần gửi nào.</p>
          )}
        </div>
      </div>
    </section>
  );
};

const PAGE_SIZE = 20;

const TeamsWebhookPage = () => {
  useDocumentTitle('Teams Webhook');
  const { hasPermission } = useAuth();
  const canManage = hasPermission(PERMISSION_CODE.TEAMS_WEBHOOK_MANAGE);
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<CrudFeedback | null>(null);
  const [filters, setFilters] = useState<TeamsDeliveryListParams>({ page: 1, pageSize: PAGE_SIZE });
  const [orderCodeInput, setOrderCodeInput] = useState('');
  const orderCode = useDebounce(orderCodeInput, 400).trim() || undefined;
  const deliveryParams: TeamsDeliveryListParams = {
    ...filters,
    orderCode,
    // A new search starts from the first page.
    page: orderCode === filters.orderCode ? filters.page : 1,
  };

  const workflowsQuery = useQuery({
    queryKey: queryKeys.teamsWorkflows.list,
    queryFn: ({ signal }) => listTeamsWorkflows(signal),
  });
  const deliveriesQuery = useQuery({
    queryKey: queryKeys.teamsWorkflows.deliveries({ ...deliveryParams }),
    queryFn: ({ signal }) => listTeamsDeliveries(deliveryParams, signal),
    // Messages move PENDING → SENT within seconds; keep the log honest.
    refetchInterval: 15_000,
  });
  const retryMutation = useMutation({
    mutationFn: retryTeamsDelivery,
    onSuccess: async () => {
      setFeedback({ type: 'success', message: 'Đã đưa tin vào hàng đợi gửi lại.' });
      await queryClient.invalidateQueries({ queryKey: queryKeys.teamsWorkflows.all });
    },
    onError: (error) => setFeedback({ type: 'error', message: getApiErrorMessage(error, 'Không gửi lại được.') }),
  });

  const columns: Column<TeamsDelivery>[] = [
    { header: 'Thời gian', accessor: 'created_at', render: (item) => <span className="whitespace-nowrap">{formatDateTime(item.created_at)}</span> },
    {
      header: 'Mã đơn',
      accessor: 'order_code',
      render: (item) => item.is_test
        ? <span className="text-slate-500">Tin gửi thử</span>
        : <span className="font-mono text-xs font-semibold">{item.order_code ?? '—'}</span>,
    },
    { header: 'Trạng thái đơn', accessor: 'order_status', render: (item) => item.order_status ?? '—' },
    { header: 'Trạng thái gửi', accessor: 'status', render: (item) => <StatusBadge status={item.status} /> },
    { header: 'Kết quả', accessor: 'last_http_status', render: deliveryResult },
    {
      header: 'Lỗi',
      accessor: 'last_error',
      render: (item) => item.last_error
        ? <span className="text-xs text-rose-600">{item.last_error}{item.status === 'PENDING' && item.next_attempt_at ? ` · thử lại lúc ${formatDateTime(item.next_attempt_at)}` : ''}</span>
        : '—',
    },
    { header: 'Số lần thử', accessor: 'attempts' },
    {
      header: '',
      accessor: 'id',
      render: (item) => canManage && item.status === 'FAILED' ? (
        <button
          type="button"
          disabled={retryMutation.isPending}
          onClick={() => retryMutation.mutate(item.id)}
          className={getButtonClassName({ variant: 'secondary', size: 'xs' })}
        >
          Gửi lại
        </button>
      ) : null,
    },
  ];

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      <CrudPageHeader title="Teams Webhook" />
      <CrudFeedbackToast feedback={feedback} onClose={() => setFeedback(null)} />
      <p className="text-sm text-slate-600">
        Mỗi chức năng gửi tới một Teams Workflow riêng. Workflow tự quyết định đăng vào nhóm chat nào.
        URL của Workflow khai báo trong server/.env; trang này dùng để bật/tắt, gửi thử và xem nhật ký.
        {!canManage && ' Bạn chỉ có quyền xem.'}
      </p>

      {workflowsQuery.isPending ? (
        <CardSkeleton lines={4} label="Đang tải cấu hình Workflow" />
      ) : workflowsQuery.isError ? (
        <ErrorState
          message={getApiErrorMessage(workflowsQuery.error, 'Không tải được cấu hình Workflow.')}
          onRetry={() => void workflowsQuery.refetch()}
        />
      ) : (
        <div className="space-y-3">
          {workflowsQuery.data.map((workflow) => (
            <WorkflowCard
              // Remount after a save so the form starts from the stored state.
              key={`${workflow.function_code}:${workflow.updated_at ?? 'new'}`}
              workflow={workflow}
              canManage={canManage}
              onFeedback={setFeedback}
            />
          ))}
        </div>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-base font-bold text-slate-900">Nhật ký gửi</h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-semibold text-slate-600">
              <span className="mb-1 block">Mã đơn</span>
              <input
                type="search"
                value={orderCodeInput}
                placeholder="ORD-…"
                onChange={(event) => setOrderCodeInput(event.target.value)}
                className={`${inputClassName} w-40`}
              />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              <span className="mb-1 block">Trạng thái gửi</span>
              <select
                value={filters.status ?? ''}
                onChange={(event) => setFilters((current) => ({
                  ...current,
                  orderCode,
                  page: 1,
                  status: (event.target.value || undefined) as TeamsDeliveryStatus | undefined,
                }))}
                className={`${inputClassName} w-36`}
              >
                <option value="">Tất cả</option>
                <option value="PENDING">Đang chờ</option>
                <option value="SENT">Đã gửi</option>
                <option value="FAILED">Thất bại</option>
              </select>
            </label>
          </div>
        </div>
        {deliveriesQuery.isError ? (
          <ErrorState
            message={getApiErrorMessage(deliveriesQuery.error, 'Không tải được nhật ký gửi.')}
            onRetry={() => void deliveriesQuery.refetch()}
          />
        ) : (
          <DataTable
            columns={columns}
            data={deliveriesQuery.data?.data ?? []}
            loading={deliveriesQuery.isPending}
            keyExtractor={(item) => item.id}
            hideInternalSearch
            pagination={deliveriesQuery.data?.pagination}
            onPageChange={(page) => setFilters((current) => ({ ...current, orderCode, page }))}
            onPageSizeChange={(pageSize) => setFilters((current) => ({ ...current, orderCode, page: 1, pageSize }))}
            emptyText="Chưa có tin nào được gửi."
          />
        )}
      </section>
    </div>
  );
};

export default TeamsWebhookPage;
