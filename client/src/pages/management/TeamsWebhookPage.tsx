import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { getApiErrorMessage } from '../../api/errors';
import {
  listTeamsWebhooks,
  saveTeamsWebhookUrl,
  sendTeamsWebhookTest,
  setTeamsWebhookActive,
} from '../../api/teams-webhooks.service';
import { AppTooltip } from '../../components/common/AppTooltip';
import { getButtonClassName } from '../../components/common/Button';
import { CardSkeleton } from '../../components/common/skeleton';
import {
  CrudFeedbackToast,
  CrudPageHeader,
  ErrorState,
  inputClassName,
} from '../../components/crud/CrudPrimitives';
import { PERMISSION_CODE } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import type { CrudFeedback } from '../../hooks/useCrudResource';
import { queryKeys } from '../../lib/queryKeys';
import type { TeamsWebhook } from '../../types/teams-webhooks';

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
/** dd/MM/yyyy HH:mm in Asia/Bangkok. */
const formatDateTime = (value: string) => dateTimeFormatter.format(new Date(value)).replace(',', '');

/** A switch that is a real checkbox underneath, so it keeps native keyboard behaviour. */
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
      className="relative h-5 w-9 rounded-full bg-slate-300 transition peer-checked:bg-stone-800 peer-disabled:opacity-60 peer-focus-visible:ring-2 peer-focus-visible:ring-stone-500 peer-focus-visible:ring-offset-2 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4"
    />
    {label}
  </label>
);

const LastSent = ({ webhook }: { webhook: TeamsWebhook }) => {
  if (!webhook.last_sent_at) {
    return <span className="text-slate-500">Chưa gửi</span>;
  }
  const badge = webhook.last_success ? (
    <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
      Thành công
    </span>
  ) : (
    <span tabIndex={0} className="inline-flex cursor-help rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
      Thất bại
    </span>
  );
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-slate-700">{formatDateTime(webhook.last_sent_at)}</span>
      {webhook.last_success ? badge : (
        <AppTooltip content={webhook.last_error ?? `HTTP ${webhook.last_http_status ?? '—'}`}>{badge}</AppTooltip>
      )}
    </span>
  );
};

const WebhookCard = ({
  webhook,
  canManage,
  onFeedback,
}: {
  webhook: TeamsWebhook;
  canManage: boolean;
  onFeedback: (feedback: CrudFeedback) => void;
}) => {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.teamsWebhooks.all });
  // Write-only: typed here, sent once, then cleared. The server never returns it.
  const [urlInput, setUrlInput] = useState('');

  const urlMutation = useMutation({
    mutationFn: (webhookUrl: string) => saveTeamsWebhookUrl(webhook.code, webhookUrl),
    onSuccess: async () => {
      setUrlInput('');
      onFeedback({ type: 'success', message: 'Đã lưu URL Workflow vào Supabase.' });
      await refresh();
    },
    onError: (error) => onFeedback({ type: 'error', message: getApiErrorMessage(error, 'Không lưu được URL Workflow.') }),
  });
  const submitUrl = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = urlInput.trim();
    if (value) urlMutation.mutate(value);
  };

  const toggleMutation = useMutation({
    mutationFn: (isActive: boolean) => setTeamsWebhookActive(webhook.code, isActive),
    onSuccess: async (saved) => {
      onFeedback({ type: 'success', message: saved.is_active ? `Đã bật "${saved.title}".` : `Đã tắt "${saved.title}".` });
      await refresh();
    },
    onError: (error) => onFeedback({ type: 'error', message: getApiErrorMessage(error, 'Không đổi được trạng thái.') }),
  });
  const testMutation = useMutation({
    mutationFn: () => sendTeamsWebhookTest(webhook.code),
    onSuccess: async (result) => {
      onFeedback(result.success
        ? { type: 'success', message: 'Gửi thử thành công.' }
        : { type: 'error', message: `Gửi thử thất bại${result.http_status ? ` (HTTP ${result.http_status})` : ''}.` });
      await refresh();
    },
    onError: (error) => onFeedback({ type: 'error', message: getApiErrorMessage(error, 'Không gửi được tin thử.') }),
  });

  const busy = toggleMutation.isPending || testMutation.isPending || urlMutation.isPending;
  const locked = !canManage || !webhook.configured || busy;
  const checked = toggleMutation.isPending ? toggleMutation.variables : webhook.is_active;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-900">{webhook.title}</h2>
          {webhook.description && <p className="mt-0.5 text-sm text-slate-500">{webhook.description}</p>}
          {!webhook.configured && (
            <span className="mt-2 inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
              Chưa cấu hình URL trong Supabase
            </span>
          )}
        </div>
        <Toggle
          checked={checked}
          disabled={locked}
          onChange={(value) => toggleMutation.mutate(value)}
          label={checked ? 'Đang bật' : 'Đang tắt'}
        />
      </div>

      {canManage && (
        <form onSubmit={submitUrl} className="mt-4 flex flex-wrap items-end gap-2" autoComplete="off">
          <label className="min-w-0 flex-1 text-xs font-semibold text-slate-600">
            <span className="mb-1 block">URL Workflow (HTTP POST URL)</span>
            <input
              type="password"
              name={`teams-webhook-url-${webhook.code}`}
              autoComplete="off"
              spellCheck={false}
              value={urlInput}
              disabled={busy}
              placeholder={webhook.configured ? '•••••••• Đã lưu — nhập URL mới để thay' : 'Dán HTTP POST URL của Workflow'}
              onChange={(event) => setUrlInput(event.target.value)}
              className={`${inputClassName} w-full font-mono`}
            />
          </label>
          <button
            type="submit"
            disabled={busy || !urlInput.trim()}
            className={getButtonClassName({ variant: 'info', size: 'sm' })}
          >
            {urlMutation.isPending ? 'Đang lưu…' : 'Lưu URL'}
          </button>
        </form>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-500">Lần gửi gần nhất:</span>
          <LastSent webhook={webhook} />
        </div>
        <button
          type="button"
          disabled={locked}
          onClick={() => testMutation.mutate()}
          className={getButtonClassName({ variant: 'secondary', size: 'sm' })}
        >
          {testMutation.isPending ? 'Đang gửi…' : 'Gửi thử'}
        </button>
      </div>
    </section>
  );
};

const TeamsWebhookPage = () => {
  useDocumentTitle('Teams Webhook');
  const { hasPermission } = useAuth();
  const canManage = hasPermission(PERMISSION_CODE.TEAMS_WEBHOOK_MANAGE);
  const [feedback, setFeedback] = useState<CrudFeedback | null>(null);

  const webhooksQuery = useQuery({
    queryKey: queryKeys.teamsWebhooks.all,
    queryFn: ({ signal }) => listTeamsWebhooks(signal),
  });

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      <CrudPageHeader title="Teams Webhook" />
      <CrudFeedbackToast feedback={feedback} onClose={() => setFeedback(null)} />

      {webhooksQuery.isPending ? (
        <CardSkeleton lines={3} label="Đang tải Teams Webhook" />
      ) : webhooksQuery.isError ? (
        <ErrorState
          message={getApiErrorMessage(webhooksQuery.error, 'Không tải được Teams Webhook.')}
          onRetry={() => void webhooksQuery.refetch()}
        />
      ) : webhooksQuery.data.length === 0 ? (
        <p className="text-sm text-slate-500">Chưa có chức năng Teams Webhook nào.</p>
      ) : (
        <div className="space-y-3">
          {webhooksQuery.data.map((webhook) => (
            <WebhookCard key={webhook.code} webhook={webhook} canManage={canManage} onFeedback={setFeedback} />
          ))}
        </div>
      )}
    </div>
  );
};

export default TeamsWebhookPage;
