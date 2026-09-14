import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listAreas } from '../../api/areas.service';
import { listOrders } from '../../api/orders.service';
import { getWorkShifts } from '../../api/work-shifts.service';
import { InfoButton, TextButton } from '../../components/common/Button';
import { DataTable, type Column } from '../../components/common/DataTable';
import { ErrorState, inputClassName } from '../../components/crud/CrudPrimitives';
import {
  FilterField,
  FilterSection,
  PageFilterLayout,
  PageFilterRail,
} from '../../components/filters';
import { OrderStatusBadge } from '../../components/orders/OrderStatusBadge';
import { PERMISSION_CODE } from '../../constants/permissions';
import { getWorkspacePath } from '../../constants/workspaces';
import { useAuth } from '../../context/AuthContext';
import { useDebounce } from '../../hooks/useDebounce';
import { usePaginatedResource } from '../../hooks/usePaginatedResource';
import { queryKeys } from '../../lib/queryKeys';
import type { PaginationParams, SortOrder } from '../../types/pagination.types';
import {
  ORDER_STATUSES,
  type Order,
  type OrderListParams,
  type OrderStatus,
} from '../../types/orders';

type OrderQuery = OrderListParams & PaginationParams;

const INITIAL_QUERY: OrderQuery = {
  page: 1,
  pageSize: 20,
  sortBy: 'created_at',
  sortOrder: 'desc',
};

const dateTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short',
  timeStyle: 'short',
});

const formatDate = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date);
};

const OrdersListPage = () => {
  const { role, hasPermission } = useAuth();
  const ordersPath = getWorkspacePath(role, 'orders');
  const createOrderPath = getWorkspacePath(role, 'orders/create');
  const loader = useCallback(
    (query: OrderQuery, signal: AbortSignal) => listOrders(query, signal),
    [],
  );
  const resource = usePaginatedResource<Order, OrderQuery>({
    loader,
    initialQuery: INITIAL_QUERY,
    loadErrorMessage: 'Không thể tải danh sách order.',
    queryKey: queryKeys.orders.lists,
  });
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 400);
  const resourceSearch = resource.query.search;
  const updateResourceQuery = resource.updateQuery;

  const areasQuery = useQuery({
    queryKey: queryKeys.areas.lookup({ pageSize: 100, isActive: true }),
    queryFn: ({ signal }) => listAreas(
      { page: 1, pageSize: 100, isActive: true, sortBy: 'code', sortOrder: 'asc' },
      signal,
    ),
    staleTime: 10 * 60 * 1000,
  });
  const workShiftsQuery = useQuery({
    queryKey: queryKeys.workShifts.lookup(),
    queryFn: ({ signal }) => getWorkShifts(signal),
    staleTime: 10 * 60 * 1000,
  });
  const areaOptions = useMemo(() => areasQuery.data?.data ?? [], [areasQuery.data]);
  const workShiftOptions = useMemo(
    () => workShiftsQuery.data ?? [],
    [workShiftsQuery.data],
  );

  useEffect(() => {
    const search = debouncedSearch.trim() || undefined;
    if (search !== resourceSearch) updateResourceQuery({ search });
  }, [debouncedSearch, resourceSearch, updateResourceQuery]);

  const resetFilters = useCallback(() => {
    setSearchInput('');
    updateResourceQuery({
      search: undefined,
      status: undefined,
      areaId: undefined,
      workShiftId: undefined,
      dateFrom: undefined,
      dateTo: undefined,
    });
  }, [updateResourceQuery]);

  const filtersAreDefault = searchInput.length === 0
    && !resource.query.status
    && !resource.query.areaId
    && !resource.query.workShiftId
    && !resource.query.dateFrom
    && !resource.query.dateTo;

  const columns: Column<Order>[] = [
    {
      header: 'Mã order',
      accessor: 'code',
      sortKey: 'code',
      render: (order) => <span className="font-semibold text-slate-900">{order.code}</span>,
    },
    {
      header: 'Trạng thái',
      accessor: 'status',
      sortKey: 'status',
      render: (order) => <OrderStatusBadge status={order.status} />,
    },
    {
      header: 'Từ area',
      accessor: 'from_area',
      render: (order) => order.from_area?.name ?? '—',
    },
    {
      header: 'Đến area',
      accessor: 'to_area',
      render: (order) => order.to_area?.name ?? '—',
    },
    {
      header: 'Ca làm việc',
      accessor: 'shift_order_sheet',
      render: (order) => order.shift_order_sheet?.work_shift?.code ?? '—',
    },
    {
      header: 'Ngày tạo',
      accessor: 'created_at',
      sortKey: 'created_at',
      render: (order) => (
        <span className="whitespace-nowrap">{formatDate(order.created_at)}</span>
      ),
    },
    {
      header: 'Thao tác',
      accessor: 'actions',
      render: (order) => (
        <Link to={`${ordersPath}/${order.id}`} className={TextButton}>
          Xem chi tiết
        </Link>
      ),
    },
  ];

  return (
    <PageFilterLayout
      rail={(
        <PageFilterRail
          title="Bộ lọc Order lịch sử"
          onReset={resetFilters}
          resetDisabled={filtersAreDefault}
        >
          <FilterSection title="Điều kiện">
            <FilterField label="Tìm kiếm">
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Tìm mã order hoặc ghi chú..."
                className={inputClassName}
              />
            </FilterField>
            <FilterField label="Trạng thái">
              <select
                value={resource.query.status ?? ''}
                onChange={(event) => updateResourceQuery({
                  status: (event.target.value || undefined) as OrderStatus | undefined,
                })}
                className={inputClassName}
              >
                <option value="">Tất cả trạng thái</option>
                {ORDER_STATUSES.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Khu vực">
              <select
                value={resource.query.areaId ?? ''}
                onChange={(event) => updateResourceQuery({
                  areaId: event.target.value || undefined,
                })}
                className={inputClassName}
                disabled={areasQuery.isPending || Boolean(areasQuery.error)}
              >
                <option value="">
                  {areasQuery.error ? 'Không tải được khu vực' : 'Tất cả khu vực'}
                </option>
                {areaOptions.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.code} — {area.name}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Ca làm việc">
              <select
                value={resource.query.workShiftId ?? ''}
                onChange={(event) => updateResourceQuery({
                  workShiftId: event.target.value || undefined,
                })}
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
            <FilterField label="Từ ngày">
              <input
                type="date"
                value={resource.query.dateFrom ?? ''}
                onChange={(event) => updateResourceQuery({
                  dateFrom: event.target.value || undefined,
                })}
                className={inputClassName}
              />
            </FilterField>
            <FilterField label="Đến ngày">
              <input
                type="date"
                value={resource.query.dateTo ?? ''}
                onChange={(event) => updateResourceQuery({
                  dateTo: event.target.value || undefined,
                })}
                className={inputClassName}
              />
            </FilterField>
          </FilterSection>
          <FilterSection title="Sắp xếp">
            <FilterField label="Theo trường">
              <select
                value={resource.query.sortBy ?? 'created_at'}
                onChange={(event) => updateResourceQuery({ sortBy: event.target.value })}
                className={inputClassName}
              >
                <option value="created_at">Ngày tạo</option>
                <option value="updated_at">Ngày cập nhật</option>
                <option value="code">Mã order</option>
                <option value="status">Trạng thái</option>
              </select>
            </FilterField>
            <FilterField label="Thứ tự">
              <select
                value={resource.query.sortOrder ?? 'desc'}
                onChange={(event) => updateResourceQuery({
                  sortOrder: event.target.value as SortOrder,
                })}
                className={inputClassName}
              >
                <option value="desc">Giảm dần</option>
                <option value="asc">Tăng dần</option>
              </select>
            </FilterField>
          </FilterSection>
        </PageFilterRail>
      )}
    >
      <section className="min-w-0 space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-blue-600">
              Order management
            </p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">Order lịch sử</h1>
            <p className="mt-1 text-sm text-slate-500">
              Tra cứu Order theo trạng thái, khu vực, ca làm việc và thời gian.
            </p>
          </div>
          {hasPermission(PERMISSION_CODE.SUPPLY_ORDER_CREATE) && (
            <Link to={createOrderPath} className={InfoButton}>Tạo order</Link>
          )}
        </div>

        {resource.error ? (
          <ErrorState message={resource.error} onRetry={() => void resource.reload()} />
        ) : (
          <DataTable
            columns={columns}
            data={resource.items}
            loading={resource.loading}
            keyExtractor={(order) => order.id}
            hideInternalSearch
            pagination={resource.pagination}
            onPageChange={resource.setPage}
            onPageSizeChange={resource.setPageSize}
            sortBy={resource.query.sortBy}
            sortOrder={resource.query.sortOrder}
            onSortChange={(sortBy, sortOrder) => updateResourceQuery({ sortBy, sortOrder })}
            emptyText="Không có Order phù hợp."
          />
        )}
      </section>
    </PageFilterLayout>
  );
};

export default OrdersListPage;
