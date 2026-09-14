import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { getMyAreaScopes } from '../../api/area-scopes.service';
import { getApiErrorMessage } from '../../api/errors';
import { listOrderStatuses } from '../../api/lookups.service';
import {
  getCurrentShiftOrderSheet,
  getShiftOrderSheet,
  listShiftOrderSheets,
} from '../../api/shift-order-sheets.service';
import { listSupplyCategories } from '../../api/supply-categories.service';
import { getWorkShifts } from '../../api/work-shifts.service';
import { SecondaryButton, TextButton } from '../../components/common/Button';
import { DataTable, type Column } from '../../components/common/DataTable';
import { CardSkeleton } from '../../components/common/skeleton';
import { ErrorState, inputClassName } from '../../components/crud/CrudPrimitives';
import {
  FilterField,
  FilterSection,
  PageFilterLayout,
  PageFilterRail,
} from '../../components/filters';
import { ShiftOrderSheetWorkspace } from '../../components/orders/ShiftOrderSheetWorkspace';
import { useAuth } from '../../context/AuthContext';
import { useDebounce } from '../../hooks/useDebounce';
import { queryKeys } from '../../lib/queryKeys';
import type {
  ShiftOrderSheetDetailParams,
  ShiftOrderSheetListParams,
  ShiftOrderSheetSummary,
} from '../../types/shift-order-sheets';

const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';

interface SheetFilters {
  areaId?: string;
  workShiftId?: string;
  workDate?: string;
  statusId?: string;
  categoryId?: string;
}

const formatDate = (value: string): string => new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: BUSINESS_TIME_ZONE,
}).format(new Date(`${value}T00:00:00+07:00`));

const ShiftOrderSheetsPage = () => {
  const { user } = useAuth();
  const assignedAreaId = user?.publicData.area_id ?? '';
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(20);
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<SheetFilters>({});
  const debouncedSearch = useDebounce(searchInput, 400);

  const areaScopesQuery = useQuery({
    queryKey: queryKeys.meAreaScopes.all,
    queryFn: ({ signal }) => getMyAreaScopes(signal),
    staleTime: 5 * 60 * 1000,
  });
  const workShiftsQuery = useQuery({
    queryKey: queryKeys.workShifts.lookup(),
    queryFn: ({ signal }) => getWorkShifts(signal),
    staleTime: 10 * 60 * 1000,
  });
  const statusesQuery = useQuery({
    queryKey: queryKeys.orderStatuses.lookup({ pageSize: 100, isActive: true }),
    queryFn: ({ signal }) => listOrderStatuses(
      { page: 1, pageSize: 100, isActive: true },
      signal,
    ),
    staleTime: 10 * 60 * 1000,
  });
  const categoriesQuery = useQuery({
    queryKey: queryKeys.supplyCategories.lookup({ pageSize: 100, isActive: true }),
    queryFn: ({ signal }) => listSupplyCategories(
      { page: 1, pageSize: 100, isActive: true, sortBy: 'code', sortOrder: 'asc' },
      signal,
    ),
    staleTime: 10 * 60 * 1000,
  });

  const areaTypeScopes = areaScopesQuery.data?.areaTypes ?? [];
  const workShiftOptions = workShiftsQuery.data ?? [];
  const statusOptions = statusesQuery.data?.data ?? [];
  const categoryOptions = categoriesQuery.data?.data ?? [];

  const currentQuery = useQuery({
    queryKey: queryKeys.shiftOrderSheets.current,
    queryFn: ({ signal }) => getCurrentShiftOrderSheet(signal),
    enabled: !historyOpen && Boolean(assignedAreaId),
  });

  const detailParams = useMemo<ShiftOrderSheetDetailParams>(() => ({
    search: debouncedSearch.trim() || undefined,
    statusId: filters.statusId,
    categoryId: filters.categoryId,
  }), [debouncedSearch, filters.categoryId, filters.statusId]);

  const historyParams = useMemo<ShiftOrderSheetListParams>(() => ({
    page: historyPage,
    pageSize: historyPageSize,
    search: detailParams.search,
    areaId: filters.areaId,
    workShiftId: filters.workShiftId,
    workDate: filters.workDate,
    statusId: filters.statusId,
    categoryId: filters.categoryId,
    sortBy: 'work_date',
    sortOrder: 'desc',
  }), [detailParams.search, filters, historyPage, historyPageSize]);

  const historyQuery = useQuery({
    queryKey: queryKeys.shiftOrderSheets.history({ ...historyParams }),
    queryFn: ({ signal }) => listShiftOrderSheets(historyParams, signal),
    enabled: historyOpen,
    placeholderData: (previous) => previous,
  });

  const selectedHistoryQuery = useQuery({
    queryKey: [
      ...queryKeys.shiftOrderSheets.detail(selectedHistoryId ?? ''),
      detailParams,
    ],
    queryFn: ({ signal }) => getShiftOrderSheet(selectedHistoryId!, signal, detailParams),
    enabled: Boolean(selectedHistoryId),
    placeholderData: (previous) => previous,
  });

  const openHistory = useCallback(() => setHistoryOpen(true), []);

  const updateFilter = useCallback((patch: Partial<SheetFilters>, closeDetail = false) => {
    setFilters((current) => ({ ...current, ...patch }));
    setHistoryPage(1);
    setHistoryOpen(true);
    if (closeDetail) setSelectedHistoryId(null);
  }, []);

  const resetFilters = useCallback(() => {
    setSearchInput('');
    setFilters({});
    setHistoryPage(1);
    setSelectedHistoryId(null);
    setHistoryOpen(true);
  }, []);

  const showCurrent = useCallback(() => {
    setSelectedHistoryId(null);
    setHistoryOpen(false);
  }, []);

  const filtersAreDefault = searchInput.length === 0
    && !filters.areaId
    && !filters.workShiftId
    && !filters.workDate
    && !filters.statusId
    && !filters.categoryId;

  const historyColumns = useMemo<Column<ShiftOrderSheetSummary>[]>(() => [
    {
      header: 'Ngày',
      accessor: 'work_date',
      render: (sheet) => <span className="font-semibold text-slate-900">{formatDate(sheet.work_date)}</span>,
    },
    {
      header: 'Ca',
      accessor: 'work_shift_id',
      render: (sheet) => sheet.work_shift ? `${sheet.work_shift.code} — ${sheet.work_shift.name}` : '—',
    },
    {
      header: 'Khu vực',
      accessor: 'area_id',
      render: (sheet) => sheet.area ? `${sheet.area.code} — ${sheet.area.name}` : '—',
    },
    { header: 'Số Order', accessor: 'order_count', render: (sheet) => sheet.order_count },
    { header: 'Số mã', accessor: 'item_count', render: (sheet) => sheet.item_count },
    {
      header: 'Thao tác',
      accessor: 'id',
      render: (sheet) => (
        <button type="button" className={TextButton} onClick={() => setSelectedHistoryId(sheet.id)}>
          Xem phiếu
        </button>
      ),
    },
  ], []);

  const filterRail = (
    <PageFilterRail
      title="Bộ lọc Phiếu Order Ca"
      onReset={resetFilters}
      resetDisabled={filtersAreDefault}
    >
      <FilterSection title="Điều kiện">
        <FilterField label="Tìm mã hàng">
          <input
            type="search"
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
              setHistoryPage(1);
              setHistoryOpen(true);
            }}
            placeholder="Nhập mã vật tư..."
            className={inputClassName}
          />
        </FilterField>

        {areaScopesQuery.isPending && (
          <FilterField label="Khu vực">
            <select className={inputClassName} disabled aria-label="Đang tải phạm vi khu vực">
              <option>Đang tải khu vực...</option>
            </select>
          </FilterField>
        )}
        {!areaScopesQuery.isPending && areaTypeScopes.length > 0 && (
          <FilterField label="Khu vực">
            <select
              value={filters.areaId ?? ''}
              onChange={(event) => updateFilter(
                { areaId: event.target.value || undefined },
                true,
              )}
              className={inputClassName}
            >
              <option value="">Tất cả khu vực được phép</option>
              {areaTypeScopes.map((areaType) => (
                <optgroup key={areaType.id} label={areaType.name}>
                  {areaType.areas.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.code} — {area.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </FilterField>
        )}

        <FilterField label="Ca làm việc">
          <select
            value={filters.workShiftId ?? ''}
            onChange={(event) => updateFilter(
              { workShiftId: event.target.value || undefined },
              true,
            )}
            className={inputClassName}
            disabled={workShiftsQuery.isPending || Boolean(workShiftsQuery.error)}
          >
            <option value="">
              {workShiftsQuery.error ? 'Không tải được ca' : 'Tất cả ca'}
            </option>
            {workShiftOptions.map((workShift) => (
              <option key={workShift.id} value={workShift.id}>
                {workShift.code} — {workShift.name}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Ngày làm việc">
          <input
            type="date"
            value={filters.workDate ?? ''}
            onChange={(event) => updateFilter(
              { workDate: event.target.value || undefined },
              true,
            )}
            className={inputClassName}
          />
        </FilterField>

        <FilterField label="Trạng thái Order">
          <select
            value={filters.statusId ?? ''}
            onChange={(event) => updateFilter({ statusId: event.target.value || undefined })}
            className={inputClassName}
            disabled={statusesQuery.isPending || Boolean(statusesQuery.error)}
          >
            <option value="">
              {statusesQuery.error ? 'Không tải được trạng thái' : 'Tất cả trạng thái'}
            </option>
            {statusOptions.map((status) => (
              <option key={status.id} value={status.id}>
                {status.code} — {status.name}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Loại mã hàng">
          <select
            value={filters.categoryId ?? ''}
            onChange={(event) => updateFilter({ categoryId: event.target.value || undefined })}
            className={inputClassName}
            disabled={categoriesQuery.isPending || Boolean(categoriesQuery.error)}
          >
            <option value="">
              {categoriesQuery.error ? 'Không tải được danh mục' : 'Tất cả danh mục'}
            </option>
            {categoryOptions.map((category) => (
              <option key={category.id} value={category.id}>
                {category.code} — {category.name}
              </option>
            ))}
          </select>
        </FilterField>
      </FilterSection>
    </PageFilterRail>
  );

  let content;
  if (!historyOpen) {
    if (!assignedAreaId) {
      content = (
        <section className="space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">Phiếu order ca</h1>
          <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-800">
            <p className="font-semibold">Bạn chưa được gán khu vực làm việc hiện tại.</p>
            <p className="mt-1 text-sm">Bạn vẫn có thể xem các Phiếu Order Ca trong Area Type Scope được cấp.</p>
          </div>
          <button type="button" className={SecondaryButton} onClick={openHistory}>
            Xem danh sách Phiếu Order Ca
          </button>
        </section>
      );
    } else if (currentQuery.isPending) {
      content = <CardSkeleton lines={9} label="Đang tải Phiếu Order Ca hiện tại" />;
    } else if (currentQuery.isError || !currentQuery.data) {
      content = (
        <section className="space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">Phiếu order ca</h1>
          <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-800">
            {getApiErrorMessage(currentQuery.error, 'Không thể xác định Phiếu Order Ca hiện tại.')}
          </div>
          <button type="button" className={SecondaryButton} onClick={openHistory}>
            Xem danh sách Phiếu Order Ca
          </button>
        </section>
      );
    } else {
      const { context, sheet } = currentQuery.data;
      content = (
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
          }}
          onShowHistory={openHistory}
        />
      );
    }
  } else if (selectedHistoryId) {
    if (selectedHistoryQuery.isPending) {
      content = <CardSkeleton lines={9} label="Đang tải Phiếu Order Ca" />;
    } else if (selectedHistoryQuery.isError || !selectedHistoryQuery.data) {
      content = (
        <section className="space-y-4">
          <button type="button" className={SecondaryButton} onClick={() => setSelectedHistoryId(null)}>
            ← Quay lại danh sách
          </button>
          <ErrorState
            message={getApiErrorMessage(selectedHistoryQuery.error, 'Không thể tải Phiếu Order Ca.')}
            onRetry={() => void selectedHistoryQuery.refetch()}
          />
        </section>
      );
    } else {
      const sheet = selectedHistoryQuery.data;
      content = !sheet.area || !sheet.work_shift ? (
        <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-800">
          Phiếu Order Ca thiếu Area hoặc ca làm việc hợp lệ.
        </div>
      ) : (
        <ShiftOrderSheetWorkspace
          mode="history"
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
          onBackCurrent={showCurrent}
        />
      );
    }
  } else {
    const history = historyQuery.data;
    content = (
      <section className="min-w-0 space-y-5">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-amber-600">Tra cứu</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">Phiếu Order Ca</h1>
            <p className="mt-1 text-sm text-slate-500">Dữ liệu được giới hạn theo Area Type Scope hiệu lực.</p>
          </div>
          {assignedAreaId && (
            <button type="button" className={SecondaryButton} onClick={showCurrent}>
              Phiếu hiện tại
            </button>
          )}
        </header>

        {historyQuery.isError ? (
          <ErrorState
            message={getApiErrorMessage(historyQuery.error, 'Không thể tải Phiếu Order Ca.')}
            onRetry={() => void historyQuery.refetch()}
          />
        ) : (
          <DataTable
            columns={historyColumns}
            data={history?.data ?? []}
            keyExtractor={(sheet) => sheet.id}
            loading={historyQuery.isPending}
            loadingText="Đang tải Phiếu Order Ca"
            hideInternalSearch
            emptyText="Không có phiếu phù hợp với bộ lọc."
            pagination={history?.pagination}
            onPageChange={setHistoryPage}
            onPageSizeChange={(pageSize) => {
              setHistoryPageSize(pageSize);
              setHistoryPage(1);
            }}
            sortBy="work_date"
            sortOrder="desc"
            onSortChange={() => undefined}
          />
        )}
      </section>
    );
  }

  return <PageFilterLayout rail={filterRail}>{content}</PageFilterLayout>;
};

export default ShiftOrderSheetsPage;
