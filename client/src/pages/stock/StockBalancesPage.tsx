import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { getApiErrorMessage } from '../../api/errors';
import { resolveInventoryDiscrepancy } from '../../api/inventory-discrepancies.service';
import {
  listStockBalanceDiscrepancies,
  listStockBalances,
  replaceStockBalanceLocations,
} from '../../api/stock-balances.service';
import { createStockAdjustment } from '../../api/stock-transactions.service';
import { listStorageLocations } from '../../api/storage-locations.service';
import { listSupplies } from '../../api/supplies.service';
import { DataTable, type Column } from '../../components/common/DataTable';
import { CardSkeleton } from '../../components/common/skeleton';
import { InfoButton, TextButton } from '../../components/common/Button';
import { CrudFeedbackToast, CrudModal, CrudPageHeader, ErrorState, FieldError, inputClassName, labelClassName } from '../../components/crud/CrudPrimitives';
import { PrimaryCrudDrawer } from '../../components/crud/PrimaryCrudDrawer';
import { FilterField, FilterSection, PageFilterLayout, PageFilterRail } from '../../components/filters';
import { StockAdjustmentForm } from '../../components/stock/StockAdjustmentForm';
import { StockBalanceLocationsForm } from '../../components/stock/StockBalanceLocationsForm';
import { PERMISSION_CODE } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { useStockAreaScopes } from '../../hooks/useStockAreaScopes';
import { useDebounce } from '../../hooks/useDebounce';
import { usePaginatedResource } from '../../hooks/usePaginatedResource';
import { useProviderLookup } from '../../hooks/useProviderLookup';
import { useServerLookup } from '../../hooks/useServerLookup';
import { queryKeys } from '../../lib/queryKeys';
import type { PaginationParams } from '../../types/pagination.types';
import type { StockBalance, StockBalanceListParams } from '../../types/stock-balances';
import type { CreateStockAdjustmentInput } from '../../types/stock-transactions';
import type { InventoryDiscrepancy } from '../../types/inventory-discrepancies';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

type StockBalanceQuery = StockBalanceListParams & PaginationParams;

const numberFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
const isStackBalance = (item: StockBalance) => item.supply?.category?.code === 'KIEN_SAT_TC';
const isLegacyStackBalance = (item: StockBalance) => isStackBalance(item)
  && (item.set_per_qty === null || item.stack_quantity === null);
const locationsText = (item: StockBalance) =>
  item.locations.length > 0 ? item.locations.map((location) => location.code).join(', ') : '—';

const StockBalancesPage = () => {
  useDocumentTitle('Vật tư tồn kho');
  const { hasPermission, isSystemAdmin } = useAuth();
  const queryClient = useQueryClient();
  const canAdjust = hasPermission(PERMISSION_CODE.SUPPLY_STOCK_ADJUST);
  const canResolveDiscrepancy = hasPermission(PERMISSION_CODE.SUPPLY_DISCREPANCY_RESOLVE);
  const loader = useCallback((query: StockBalanceQuery, signal: AbortSignal) => listStockBalances(query, signal), []);
  const resource = usePaginatedResource<StockBalance, StockBalanceQuery>({
    loader,
    initialQuery: { page: 1, pageSize: 20, sortBy: 'updated_at', sortOrder: 'desc' },
    loadErrorMessage: 'Không thể tải dữ liệu tồn kho.',
    queryKey: queryKeys.stockBalances.lists,
    invalidateQueryKeys: [
      queryKeys.stockTransactions.all,
      queryKeys.supplyStackOptions.all,
    ],
  });
  // Only the Areas this user may read stock for; the backend applies the
  // same rule to the rows, so an Area missing here would return nothing.
  const areaScopes = useStockAreaScopes();
  const providers = useProviderLookup();
  const supplyLoader = useCallback(
    (search: string | undefined, signal: AbortSignal) => listSupplies(
      { page: 1, pageSize: 20, search, isActive: true, isDeleted: false, sortBy: 'code', sortOrder: 'asc' },
      signal,
    ),
    [],
  );
  const locationLoader = useCallback(
    (search: string | undefined, signal: AbortSignal) => listStorageLocations(
      { page: 1, pageSize: 20, search, areaId: resource.query.areaId, isActive: true, sortBy: 'code', sortOrder: 'asc' },
      signal,
    ),
    [resource.query.areaId],
  );
  const supplies = useServerLookup({
    loader: supplyLoader,
    queryKey: (search) => queryKeys.supplies.lookup({ search, pageSize: 20, isActive: true, isDeleted: false }),
    errorMessage: 'Không thể tải danh sách vật tư.',
  });
  const locations = useServerLookup({
    loader: locationLoader,
    queryKey: (search) => queryKeys.storageLocations.lookup({ search, areaId: resource.query.areaId, pageSize: 20, isActive: true }),
    errorMessage: 'Không thể tải danh sách vị trí kho.',
  });
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 400);
  const resourceSearch = resource.query.search;
  const updateResourceQuery = resource.updateQuery;
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [labelBalance, setLabelBalance] = useState<StockBalance | null>(null);
  const [discrepancyBalance, setDiscrepancyBalance] = useState<StockBalance | null>(null);
  // Relabelling writes to the row's Area, so it follows the same rule as an
  // adjustment; the server enforces it again.
  const canRelabel = (item: StockBalance) => canAdjust
    && (isSystemAdmin || item.area_id === areaScopes.scopes.writableAreaId);
  const [resolveTarget, setResolveTarget] = useState<InventoryDiscrepancy | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const discrepancyQuery = useQuery({
    queryKey: queryKeys.inventoryDiscrepancies.balance(
      discrepancyBalance?.id ?? '',
      { page: 1, pageSize: 100, sortBy: 'reported_at', sortOrder: 'desc' },
    ),
    queryFn: ({ signal }) => listStockBalanceDiscrepancies(
      discrepancyBalance!.id,
      { page: 1, pageSize: 100, sortBy: 'reported_at', sortOrder: 'desc' },
      signal,
    ),
    enabled: Boolean(discrepancyBalance),
  });
  const resolveMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      resolveInventoryDiscrepancy(id, { resolution_note: note }),
  });

  useEffect(() => {
    const search = debouncedSearch.trim() || undefined;
    if (search !== resourceSearch) updateResourceQuery({ search });
  }, [debouncedSearch, resourceSearch, updateResourceQuery]);

  const columns: Column<StockBalance>[] = [
    { header: 'Vật tư', accessor: 'supply_id', render: (item) => item.supply ? <div><p className="font-semibold text-slate-800">{item.supply.code}</p><p className="text-xs text-slate-500">{item.supply.description || '—'}</p></div> : '—' },
    { header: 'Provider', accessor: 'provider_id', render: (item) => item.provider ? <div><p className="font-semibold text-slate-800">{item.provider.code}</p><p className="text-xs text-slate-500">{item.provider.name}</p></div> : '—' },
    { header: 'Khu vực', accessor: 'area_id', render: (item) => item.area ? `${item.area.code} - ${item.area.name}` : '—' },
    {
      header: 'Vị trí kho',
      accessor: 'locations',
      render: (item) => (
        <div className="flex min-w-32 flex-wrap items-center gap-1">
          {item.locations.length === 0
            ? <span className="text-xs text-slate-400">Chưa gắn</span>
            : item.locations.map((location) => (
              <span key={location.id} title={location.name ?? undefined} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700">
                {location.code}
              </span>
            ))}
          {canRelabel(item) && (
            <button type="button" onClick={() => setLabelBalance(item)} className={`${TextButton} text-xs`} aria-label={`Sửa vị trí của ${item.supply?.code ?? 'vật tư'}`}>
              Sửa
            </button>
          )}
        </div>
      ),
    },
    {
      header: 'SET / chồng',
      accessor: 'set_per_qty',
      render: (item) => {
        if (!isStackBalance(item)) return '—';
        if (isLegacyStackBalance(item)) {
          return <span className="text-xs font-semibold text-amber-700">Chưa có dữ liệu quy cách chồng</span>;
        }
        return <span className="font-semibold text-slate-800">{numberFormatter.format(item.set_per_qty!)} SET</span>;
      },
    },
    {
      header: 'Số chồng',
      accessor: 'stack_quantity',
      render: (item) => isStackBalance(item) && item.stack_quantity !== null
        ? `${numberFormatter.format(item.stack_quantity)} chồng`
        : '—',
    },
    {
      header: 'Tồn / Tổng SET',
      accessor: 'quantity',
      sortKey: 'quantity',
      render: (item) => (
        <div>
          <span className="font-bold text-slate-900">
            {numberFormatter.format(item.total_set_quantity ?? item.quantity)} {item.supply?.unit?.symbol ?? ''}
          </span>
          {isStackBalance(item) && !isLegacyStackBalance(item) && (
            <p className="text-xs text-slate-500">Tổng SET theo quy cách chồng</p>
          )}
        </div>
      ),
    },
    { header: 'Cảnh báo', accessor: 'has_open_discrepancy', render: (item) => item.has_open_discrepancy ? <button type="button" onClick={() => setDiscrepancyBalance(item)} className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800 hover:bg-amber-200">⚠ Cần kiểm kê</button> : <button type="button" onClick={() => setDiscrepancyBalance(item)} className={TextButton}>Lịch sử</button> },
    { header: 'Cập nhật lúc', accessor: 'updated_at', sortKey: 'updated_at', render: (item) => dateFormatter.format(new Date(item.updated_at)) },
  ];

  const createAdjustment = (input: CreateStockAdjustmentInput) => resource.runMutation(
    () => createStockAdjustment(input),
    'Đã cập nhật tồn kho và tạo stock transaction.',
    'Không thể tạo stock adjustment.',
  );

  // The drawer stays open when the server rejects the adjustment, so the operator
  // keeps what they typed; the failure arrives on the toast above it.
  const saveAdjustment = async (input: CreateStockAdjustmentInput) => {
    if (await createAdjustment(input)) setAdjustmentOpen(false);
  };

  const saveLocations = async (locationIds: string[]) => {
    if (!labelBalance) return;
    const saved = await resource.runMutation(
      () => replaceStockBalanceLocations(labelBalance.id, { location_ids: locationIds }),
      'Đã cập nhật vị trí kho.',
      'Không thể cập nhật vị trí kho.',
    );
    if (saved) setLabelBalance(null);
  };

  const submitResolution = async () => {
    if (!resolveTarget) return;
    const note = resolutionNote.trim();
    if (!note) return;
    try {
      await resolveMutation.mutateAsync({ id: resolveTarget.id, note });
      resource.setFeedback({ type: 'success', message: 'Đã đánh dấu discrepancy là RESOLVED.' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.stockBalances.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.inventoryDiscrepancies.all }),
      ]);
      setResolveTarget(null);
      setResolutionNote('');
    } catch (error) {
      resource.setFeedback({
        type: 'error',
        message: getApiErrorMessage(error, 'Không thể resolve discrepancy.'),
      });
    }
  };

  const resetFilters = () => {
    setSearchInput('');
    supplies.setSearch('');
    locations.setSearch('');
    resource.updateQuery({
      supplyId: undefined,
      providerId: undefined,
      areaId: undefined,
      storageLocationId: undefined,
      warning: 'all',
    });
  };
  const filtersAreDefault = searchInput.length === 0
    && supplies.search.length === 0
    && locations.search.length === 0
    && !resource.query.supplyId
    && !resource.query.providerId
    && !resource.query.areaId
    && !resource.query.storageLocationId
    && (resource.query.warning ?? 'all') === 'all';

  return <PageFilterLayout rail={(
    <PageFilterRail onReset={resetFilters} resetDisabled={filtersAreDefault}>
      <FilterSection>
        <FilterField label="Tìm kiếm"><input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Tìm mã vật tư, khu vực, vị trí..." className={inputClassName} /></FilterField>
        <FilterField label="Tìm vật tư"><input type="search" value={supplies.search} onChange={(event) => supplies.setSearch(event.target.value)} placeholder="Tìm vật tư trên server..." className={inputClassName} /></FilterField>
        <FilterField label="Vật tư"><select disabled={supplies.loading && supplies.items.length === 0} value={resource.query.supplyId ?? ''} onChange={(event) => resource.updateQuery({ supplyId: event.target.value || undefined })} className={inputClassName}><option value="">{supplies.loading && supplies.items.length === 0 ? 'Đang tải vật tư...' : 'Tất cả vật tư'}</option>{supplies.items.map((supply) => <option key={supply.id} value={supply.id}>{supply.code}{supply.description ? ` - ${supply.description}` : ''}</option>)}</select></FilterField>
        <FilterField label="Cảnh báo"><select value={resource.query.warning ?? 'all'} onChange={(event) => resource.updateQuery({ warning: event.target.value as StockBalanceQuery['warning'] })} className={inputClassName}><option value="all">Tất cả cảnh báo</option><option value="warning">Có cảnh báo</option><option value="no_warning">Không cảnh báo</option></select></FilterField>
        <FilterField label="Provider"><select disabled={providers.loading && providers.items.length === 0} value={resource.query.providerId ?? ''} onChange={(event) => resource.updateQuery({ providerId: event.target.value || undefined })} className={inputClassName}><option value="">{providers.loading && providers.items.length === 0 ? 'Đang tải Provider...' : 'Tất cả Provider'}</option>{providers.items.map((provider) => <option key={provider.id} value={provider.id}>{provider.code} - {provider.name}</option>)}</select></FilterField>
        <FilterField label="Khu vực"><select disabled={areaScopes.loading} value={resource.query.areaId ?? ''} onChange={(event) => resource.updateQuery({ areaId: event.target.value || undefined, storageLocationId: undefined })} className={inputClassName}><option value="">{areaScopes.loading ? 'Đang tải khu vực...' : 'Tất cả khu vực được phép'}</option>{areaScopes.scopes.areas.map((area) => <option key={area.id} value={area.id}>{area.code} - {area.name}</option>)}</select></FilterField>
        <FilterField label="Tìm vị trí kho"><input type="search" value={locations.search} onChange={(event) => locations.setSearch(event.target.value)} placeholder="Tìm vị trí kho trên server..." className={inputClassName} /></FilterField>
        <FilterField label="Vị trí kho"><select disabled={locations.loading && locations.items.length === 0} value={resource.query.storageLocationId ?? ''} onChange={(event) => resource.updateQuery({ storageLocationId: event.target.value || undefined })} className={inputClassName}><option value="">{locations.loading && locations.items.length === 0 ? 'Đang tải vị trí kho...' : 'Tất cả vị trí kho'}</option>{locations.items.map((location) => <option key={location.id} value={location.id}>{location.code}{location.name ? ` - ${location.name}` : ''}</option>)}</select></FilterField>
      </FilterSection>
      {[supplies.error, providers.error, areaScopes.error, locations.error].some(Boolean) && <p role="alert" className="text-xs text-amber-700">Một số bộ lọc không tải được. Dữ liệu tồn kho vẫn được hiển thị.</p>}
    </PageFilterRail>
  )}><div className="min-w-0 space-y-6">
    <CrudPageHeader title="Tồn kho vật tư" onCreate={canAdjust ? () => setAdjustmentOpen(true) : undefined} />
    <CrudFeedbackToast feedback={resource.feedback} onClose={() => resource.setFeedback(null)} />
    {resource.error ? <ErrorState message={resource.error} onRetry={resource.reload} /> : <DataTable columns={columns} data={resource.items} loading={resource.loading} keyExtractor={(item) => item.id} hideInternalSearch pagination={resource.pagination} onPageChange={resource.setPage} onPageSizeChange={resource.setPageSize} sortBy={resource.query.sortBy} sortOrder={resource.query.sortOrder} onSortChange={(sortBy, sortOrder) => resource.updateQuery({ sortBy, sortOrder })} emptyText="Không có tồn kho phù hợp với bộ lọc." />}
    {adjustmentOpen && canAdjust && (
      <PrimaryCrudDrawer
        mode="create"
        title="Tạo điều chỉnh tồn kho"
        busy={resource.mutating}
        onClose={() => setAdjustmentOpen(false)}
      >
        <StockAdjustmentForm busy={resource.mutating} onSave={saveAdjustment} />
      </PrimaryCrudDrawer>
    )}
    {labelBalance && (
      <PrimaryCrudDrawer
        mode="edit"
        title="Vị trí kho của mã vật tư"
        busy={resource.mutating}
        onClose={() => setLabelBalance(null)}
      >
        <StockBalanceLocationsForm balance={labelBalance} busy={resource.mutating} onSave={saveLocations} />
      </PrimaryCrudDrawer>
    )}
    {discrepancyBalance && (
      <CrudModal
        title={`Lịch sử sai lệch — ${discrepancyBalance.supply?.code ?? 'Vật tư'}`}
        busy={resolveMutation.isPending}
        onClose={() => {
          setDiscrepancyBalance(null);
          setResolveTarget(null);
          setResolutionNote('');
        }}
      >
        <div className="mb-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-3">
          <Summary label="Nhà cung cấp" value={discrepancyBalance.provider ? `${discrepancyBalance.provider.code} — ${discrepancyBalance.provider.name}` : '—'} />
          <Summary label="Khu vực" value={discrepancyBalance.area ? `${discrepancyBalance.area.code} — ${discrepancyBalance.area.name}` : '—'} />
          <Summary label="Vị trí (nhãn)" value={locationsText(discrepancyBalance)} />
        </div>
        {discrepancyQuery.isPending ? (
          <CardSkeleton lines={6} label="Đang tải lịch sử sai lệch" />
        ) : discrepancyQuery.isError ? (
          <ErrorState
            message={getApiErrorMessage(discrepancyQuery.error, 'Không thể tải lịch sử sai lệch.')}
            onRetry={() => void discrepancyQuery.refetch()}
          />
        ) : (discrepancyQuery.data?.data.length ?? 0) === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Chưa có lịch sử sai lệch.</p>
        ) : (
          <div className="space-y-3">
            {discrepancyQuery.data!.data.map((discrepancy) => {
              const reporter = discrepancy.reporter
                ? `${discrepancy.reporter.first_name} ${discrepancy.reporter.last_name}`.trim()
                : 'Không rõ';
              const resolver = discrepancy.resolver
                ? `${discrepancy.resolver.first_name} ${discrepancy.resolver.last_name}`.trim()
                : null;
              return (
                <article key={discrepancy.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-slate-900">Order {discrepancy.order?.code ?? 'Không rõ'}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {discrepancy.source === 'ISSUE' ? 'Phát hiện khi cấp hàng' : 'Báo khi xác nhận số chồng'} · {reporter} · {dateFormatter.format(new Date(discrepancy.reported_at))}
                      </p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${discrepancy.status === 'OPEN' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>{discrepancy.status}</span>
                  </div>
                  <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-4">
                    <Summary label={discrepancy.source === 'ISSUE' ? 'Đã cấp' : 'Đã duyệt'} value={`${discrepancy.expected_stack_quantity} chồng`} />
                    <Summary label={discrepancy.source === 'ISSUE' ? 'Tồn sổ trừ được' : 'Thực tế'} value={`${discrepancy.actual_stack_quantity} chồng`} />
                    <Summary label="Chênh lệch" value={`${discrepancy.difference_stack_quantity} chồng`} />
                    <Summary label="Quy cách" value={`${discrepancy.order_item?.set_per_qty ?? '—'} SET/chồng`} />
                  </dl>
                  <p className="mt-3 text-sm text-slate-600">Lý do: {discrepancy.reason || 'Không ghi nhận'}</p>
                  {discrepancy.status === 'RESOLVED' && (
                    <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
                      <p>{discrepancy.resolution_note}</p>
                      <p className="mt-1 text-xs">
                        Xử lý bởi {resolver ?? 'Không rõ'} · {discrepancy.resolved_at
                          ? dateFormatter.format(new Date(discrepancy.resolved_at))
                          : 'Không rõ thời gian'}
                      </p>
                    </div>
                  )}
                  {discrepancy.status === 'OPEN' && canResolveDiscrepancy && (
                    <button type="button" onClick={() => { setResolveTarget(discrepancy); setResolutionNote(''); }} className={`${InfoButton} mt-3`}>Đánh dấu đã xử lý</button>
                  )}
                </article>
              );
            })}
          </div>
        )}
        {resolveTarget && (
          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <label className={labelClassName}>
              <span>Ghi chú xử lý *</span>
              <textarea rows={3} maxLength={2000} value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} className={inputClassName} />
              {!resolutionNote.trim() && <FieldError message="Ghi chú xử lý là bắt buộc." />}
            </label>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" disabled={resolveMutation.isPending} onClick={() => setResolveTarget(null)} className={TextButton}>Bỏ qua</button>
              <button type="button" disabled={resolveMutation.isPending || !resolutionNote.trim()} onClick={() => void submitResolution()} className={InfoButton}>{resolveMutation.isPending ? 'Đang xử lý...' : 'Xác nhận resolve'}</button>
            </div>
          </div>
        )}
      </CrudModal>
    )}
  </div></PageFilterLayout>;
};

const Summary = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 break-words font-semibold text-slate-800">{value}</p>
  </div>
);

export default StockBalancesPage;
