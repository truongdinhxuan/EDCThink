import { useQuery } from '@tanstack/react-query';
import { useCallback,useEffect,useState } from 'react';
import { listAreas } from '../../api/areas.service';
import { getApiErrorMessage } from '../../api/errors';
import { createStockAdjustment,getStockTransaction,listStockTransactions } from '../../api/stock-transactions.service';
import { listStorageLocations } from '../../api/storage-locations.service';
import { listSupplies } from '../../api/supplies.service';
import { TextButton } from '../../components/common/Button';
import { DataTable,type Column } from '../../components/common/DataTable';
import { CardSkeleton } from '../../components/common/skeleton';
import { CrudEntityView } from '../../components/crud/CrudEntityView';
import { CrudFeedbackToast,CrudPageHeader,ErrorState,inputClassName } from '../../components/crud/CrudPrimitives';
import { FilterField,FilterSection,PageFilterLayout,PageFilterRail } from '../../components/filters';
import { PrimaryCrudDrawer } from '../../components/crud/PrimaryCrudDrawer';
import { StockAdjustmentModal } from '../../components/stock/StockAdjustmentModal';
import { PERMISSION_CODE } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { useCrudResource } from '../../hooks/useCrudResource';
import { useDebounce } from '../../hooks/useDebounce';
import { usePaginatedResource } from '../../hooks/usePaginatedResource';
import { useProviderLookup } from '../../hooks/useProviderLookup';
import { useServerLookup } from '../../hooks/useServerLookup';
import { queryKeys } from '../../lib/queryKeys';
import type { PaginationParams } from '../../types/pagination.types';
import type { CreateStockAdjustmentInput,StockTransaction,StockTransactionListParams,StockTransactionType } from '../../types/stock-transactions';
import { STOCK_TRANSACTION_TYPES } from '../../types/stock-transactions';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

type StockTransactionQuery = StockTransactionListParams & PaginationParams;

const loadAreas = async (signal: AbortSignal) =>
  (await listAreas(
    { page: 1, pageSize: 100, isActive: true, sortBy: 'code', sortOrder: 'asc' },
    signal,
  )).data;
const numberFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 });
const dateFormatter = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
const transactionTypeClass = (type: StockTransactionType) => type.endsWith('_IN') || type === 'RECEIVE' || type === 'IMPORT' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700';
const transactionTypeCode = (transaction: StockTransaction) =>
  (transaction.transaction_type?.code ?? 'UNKNOWN') as StockTransactionType;

const StockTransactionsPage = () => {
  useDocumentTitle('Giao dịch vật tư');
  const { hasPermission } = useAuth();
  const canAdjust = hasPermission(PERMISSION_CODE.SUPPLY_STOCK_ADJUST);
  const loader = useCallback((query: StockTransactionQuery, signal: AbortSignal) => listStockTransactions(query, signal), []);
  const resource = usePaginatedResource<StockTransaction, StockTransactionQuery>({
    loader,
    initialQuery: { page: 1, pageSize: 20, sortBy: 'created_at', sortOrder: 'desc' },
    loadErrorMessage: 'Không thể tải stock transactions.',
    queryKey: queryKeys.stockTransactions.lists,
    invalidateQueryKeys: [
      queryKeys.stockBalances.all,
      queryKeys.supplyStackOptions.all,
    ],
  });
  const areas = useCrudResource(
    loadAreas,
    'Không thể tải danh sách khu vực.',
    queryKeys.areas.lookup({ pageSize: 100, isActive: true }),
  );
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
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailQuery = useQuery({
    queryKey: queryKeys.stockTransactions.detail(detailId ?? ''),
    queryFn: ({ signal }) => getStockTransaction(detailId!, signal),
    enabled: Boolean(detailId),
  });
  const detail = detailQuery.data ?? null;

  useEffect(() => {
    const search = debouncedSearch.trim() || undefined;
    if (search !== resourceSearch) updateResourceQuery({ search });
  }, [debouncedSearch, resourceSearch, updateResourceQuery]);

  const columns: Column<StockTransaction>[] = [
    { header: 'Loại', accessor: 'transaction_type_id', sortKey: 'type', render: (item) => { const type = transactionTypeCode(item); return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${transactionTypeClass(type)}`}>{type}</span>; } },
    { header: 'Vật tư', accessor: 'supply_id', render: (item) => item.supply ? <div><p className="font-semibold text-slate-800">{item.supply.code}</p><p className="text-xs text-slate-500">{item.supply.description || '—'}</p></div> : '—' },
    { header: 'Provider', accessor: 'provider_id', render: (item) => item.provider ? <div><p className="font-semibold text-slate-800">{item.provider.code}</p><p className="text-xs text-slate-500">{item.provider.name}</p></div> : '—' },
    { header: 'Khu vực / Vị trí', accessor: 'area_id', render: (item) => <div><p>{item.area ? `${item.area.code} - ${item.area.name}` : '—'}</p><p className="text-xs text-slate-500">{item.storage_location?.code ?? '—'}</p></div> },
    { header: 'Số lượng', accessor: 'quantity', sortKey: 'quantity', render: (item) => numberFormatter.format(item.quantity) },
    { header: 'Trước → Sau', accessor: 'before_quantity', render: (item) => `${numberFormatter.format(item.before_quantity)} → ${numberFormatter.format(item.after_quantity)}` },
    { header: 'Lý do', accessor: 'reason', render: (item) => item.reason || '—' },
    { header: 'Order', accessor: 'order_id', render: (item) => item.order?.code ?? '—' },
    {
      header: 'Quy cách chồng',
      accessor: 'set_per_qty',
      render: (item) => item.set_per_qty === null
        ? '—'
        : <div><p>{numberFormatter.format(item.set_per_qty)} SET/chồng</p><p className="text-xs text-slate-500">{numberFormatter.format(item.stack_quantity ?? 0)} chồng</p></div>,
    },
    { header: 'Người tạo', accessor: 'created_by', render: (item) => item.creator ? `${item.creator.first_name} ${item.creator.last_name}`.trim() : 'Không rõ' },
    { header: 'Thời gian', accessor: 'created_at', sortKey: 'created_at', render: (item) => dateFormatter.format(new Date(item.created_at)) },
    { header: 'Chi tiết', accessor: 'detail', render: (item) => <button type="button" onClick={() => setDetailId(item.id)} className={TextButton}>Xem</button> },
  ];

  const createAdjustment = (input: CreateStockAdjustmentInput) => resource.runMutation(
    () => createStockAdjustment(input),
    'Đã tạo stock adjustment và transaction audit.',
    'Không thể tạo stock adjustment.',
  );

  const detailFields: Array<[string, string]> = detail ? [
    ['Type', transactionTypeCode(detail)],
    ['Vật tư', detail.supply ? `${detail.supply.code}${detail.supply.description ? ` - ${detail.supply.description}` : ''}` : 'Không rõ'],
    ['Provider', detail.provider ? `${detail.provider.code} - ${detail.provider.name}` : 'Không rõ'],
    ['Khu vực', detail.area ? `${detail.area.code} - ${detail.area.name}` : 'Không rõ'],
    ['Vị trí kho', detail.storage_location ? `${detail.storage_location.code}${detail.storage_location.name ? ` - ${detail.storage_location.name}` : ''}` : 'Không rõ'],
    ['Số lượng', numberFormatter.format(detail.quantity)],
    ['Tồn trước', numberFormatter.format(detail.before_quantity)],
    ['Tồn sau', numberFormatter.format(detail.after_quantity)],
    ...(detail.set_per_qty !== null ? [
      ['SET / chồng', numberFormatter.format(detail.set_per_qty)],
      ['Số chồng thay đổi', numberFormatter.format(detail.stack_quantity ?? 0)],
      ['Số chồng trước', numberFormatter.format(detail.before_stack_quantity ?? 0)],
      ['Số chồng sau', numberFormatter.format(detail.after_stack_quantity ?? 0)],
    ] as Array<[string, string]> : []),
    ['Lý do', detail.reason || '—'],
    ['Ghi chú', detail.note || '—'],
    ['Người tạo', detail.creator ? `${detail.creator.first_name} ${detail.creator.last_name}`.trim() : 'Không rõ'],
    ['Thời gian', dateFormatter.format(new Date(detail.created_at))],
    ['Order', detail.order?.code ?? '—'],
    ['Sai lệch tồn', detail.discrepancy ? `${detail.discrepancy.status} — có liên kết audit` : '—'],
  ] : [];

  const resetFilters = () => {
    setSearchInput('');
    supplies.setSearch('');
    locations.setSearch('');
    resource.updateQuery({ supplyId: undefined, providerId: undefined, areaId: undefined, storageLocationId: undefined, type: undefined, createdBy: undefined, dateFrom: undefined, dateTo: undefined });
  };
  const filtersAreDefault = searchInput.length === 0
    && supplies.search.length === 0
    && locations.search.length === 0
    && !resource.query.supplyId
    && !resource.query.providerId
    && !resource.query.areaId
    && !resource.query.storageLocationId
    && !resource.query.type
    && !resource.query.createdBy
    && !resource.query.dateFrom
    && !resource.query.dateTo;

  return <PageFilterLayout rail={(
    <PageFilterRail title="Bộ lọc giao dịch tồn" onReset={resetFilters} resetDisabled={filtersAreDefault}>
      <FilterSection>
        <FilterField label="Tìm kiếm"><input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Tìm transaction, vật tư, lý do..." className={inputClassName} /></FilterField>
        <FilterField label="Tìm vật tư"><input type="search" value={supplies.search} onChange={(event) => supplies.setSearch(event.target.value)} placeholder="Tìm vật tư trên server..." className={inputClassName} /></FilterField>
        <FilterField label="Vật tư"><select disabled={supplies.loading && supplies.items.length === 0} value={resource.query.supplyId ?? ''} onChange={(event) => resource.updateQuery({ supplyId: event.target.value || undefined })} className={inputClassName}><option value="">{supplies.loading && supplies.items.length === 0 ? 'Đang tải vật tư...' : 'Tất cả vật tư'}</option>{supplies.items.map((supply) => <option key={supply.id} value={supply.id}>{supply.code}</option>)}</select></FilterField>
        <FilterField label="Provider"><select disabled={providers.loading && providers.items.length === 0} value={resource.query.providerId ?? ''} onChange={(event) => resource.updateQuery({ providerId: event.target.value || undefined })} className={inputClassName}><option value="">{providers.loading && providers.items.length === 0 ? 'Đang tải Provider...' : 'Tất cả Provider'}</option>{providers.items.map((provider) => <option key={provider.id} value={provider.id}>{provider.code} - {provider.name}</option>)}</select></FilterField>
        <FilterField label="Khu vực"><select disabled={areas.loading && areas.items.length === 0} value={resource.query.areaId ?? ''} onChange={(event) => resource.updateQuery({ areaId: event.target.value || undefined, storageLocationId: undefined })} className={inputClassName}><option value="">{areas.loading && areas.items.length === 0 ? 'Đang tải khu vực...' : 'Tất cả khu vực'}</option>{areas.items.map((area) => <option key={area.id} value={area.id}>{area.code} - {area.name}</option>)}</select></FilterField>
        <FilterField label="Tìm vị trí kho"><input type="search" value={locations.search} onChange={(event) => locations.setSearch(event.target.value)} placeholder="Tìm vị trí kho trên server..." className={inputClassName} /></FilterField>
        <FilterField label="Vị trí kho"><select disabled={locations.loading && locations.items.length === 0} value={resource.query.storageLocationId ?? ''} onChange={(event) => resource.updateQuery({ storageLocationId: event.target.value || undefined })} className={inputClassName}><option value="">{locations.loading && locations.items.length === 0 ? 'Đang tải vị trí kho...' : 'Tất cả vị trí kho'}</option>{locations.items.map((location) => <option key={location.id} value={location.id}>{location.code}</option>)}</select></FilterField>
        <FilterField label="Loại giao dịch"><select value={resource.query.type ?? ''} onChange={(event) => resource.updateQuery({ type: (event.target.value || undefined) as StockTransactionType | undefined })} className={inputClassName}><option value="">Tất cả transaction type</option>{STOCK_TRANSACTION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></FilterField>
        <FilterField label="Người tạo"><input type="text" value={resource.query.createdBy ?? ''} onChange={(event) => resource.updateQuery({ createdBy: event.target.value.trim() || undefined })} placeholder="Created by UUID" className={inputClassName} /></FilterField>
      </FilterSection>
      <FilterSection title="Thời gian">
        <FilterField label="Từ ngày"><input type="date" value={resource.query.dateFrom ?? ''} onChange={(event) => resource.updateQuery({ dateFrom: event.target.value || undefined })} className={inputClassName} /></FilterField>
        <FilterField label="Đến ngày"><input type="date" value={resource.query.dateTo ?? ''} onChange={(event) => resource.updateQuery({ dateTo: event.target.value || undefined })} className={inputClassName} /></FilterField>
      </FilterSection>
      {[supplies.error, providers.error, areas.error, locations.error].some(Boolean) && <p role="alert" className="text-xs text-amber-700">Một số bộ lọc không tải được. Danh sách transaction vẫn được hiển thị.</p>}
    </PageFilterRail>
  )}><div className="min-w-0 space-y-6">
    <CrudPageHeader title="Stock transactions" description="Audit log bất biến của mọi biến động tồn kho." createLabel="Tạo adjustment" onCreate={canAdjust ? () => setAdjustmentOpen(true) : undefined} />
    <CrudFeedbackToast feedback={resource.feedback} onClose={() => resource.setFeedback(null)} />
    {resource.error ? <ErrorState message={resource.error} onRetry={resource.reload} /> : <DataTable columns={columns} data={resource.items} loading={resource.loading} keyExtractor={(item) => item.id} hideInternalSearch pagination={resource.pagination} onPageChange={resource.setPage} onPageSizeChange={resource.setPageSize} sortBy={resource.query.sortBy} sortOrder={resource.query.sortOrder} onSortChange={(sortBy, sortOrder) => resource.updateQuery({ sortBy, sortOrder })} emptyText="Không có transaction phù hợp với bộ lọc." />}
    {detailId && <PrimaryCrudDrawer mode="view" title="Chi tiết stock transaction" onClose={() => setDetailId(null)}>{detailQuery.isPending ? <CardSkeleton lines={6} label="Đang tải chi tiết transaction" /> : detailQuery.isError ? <ErrorState message={getApiErrorMessage(detailQuery.error, 'Không thể tải chi tiết transaction.')} onRetry={() => void detailQuery.refetch()} /> : detail ? <CrudEntityView fields={detailFields.map(([label, value]) => ({ label, value }))} /> : null}</PrimaryCrudDrawer>}
    {adjustmentOpen && canAdjust && <StockAdjustmentModal busy={resource.mutating} onClose={() => setAdjustmentOpen(false)} onSubmit={createAdjustment} />}
  </div></PageFilterLayout>;
};

export default StockTransactionsPage;
