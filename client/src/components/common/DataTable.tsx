import type React from 'react';
import type { PaginationMeta, SortOrder } from '../../types/pagination.types';
import { Pagination } from './Pagination';
import { TableSkeleton } from './skeleton';
import { getButtonClassName } from './Button';

export interface Column<T> {
  header: string;
  accessor: keyof T | string;
  sortKey?: string;
  render?: (item: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  hideInternalSearch?: boolean;
  loading?: boolean;
  loadingText?: string;
  emptyText?: string;
  keyExtractor?: (item: T) => React.Key;
  renderTopToolbar?: () => React.ReactNode;
  pagination?: PaginationMeta;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  sortBy?: string;
  sortOrder?: SortOrder;
  onSortChange?: (sortBy: string, sortOrder: SortOrder) => void;
}

export const DataTable = <T extends object>({
  columns,
  data,
  searchPlaceholder = 'Search...',
  searchValue = '',
  onSearchChange,
  hideInternalSearch = false,
  loading = false,
  loadingText = 'Đang tải dữ liệu...',
  emptyText = 'Không có dữ liệu.',
  keyExtractor,
  renderTopToolbar,
  pagination,
  onPageChange,
  onPageSizeChange,
  sortBy,
  sortOrder = 'asc',
  onSortChange,
}: DataTableProps<T>) => {
  const showInternalSearch = Boolean(onSearchChange) && !hideInternalSearch;
  const showInternalToolbar = showInternalSearch || Boolean(renderTopToolbar);

  if (loading && data.length === 0) {
    return (
      <TableSkeleton
        columns={columns.length}
        showToolbar={showInternalToolbar}
        showPagination={Boolean(pagination && onPageChange && onPageSizeChange)}
        label={loadingText}
      />
    );
  }

  return (
    <div className="relative min-w-0 w-full space-y-4" aria-busy={loading}>
      {loading && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute right-0 top-0 z-10 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 shadow-sm"
        >
          Đang cập nhật...
        </div>
      )}
      {showInternalToolbar && (
        <div className="flex min-w-0 flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
            {showInternalSearch && onSearchChange && (
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-slate-700">Search:</label>
                <input
                  type="search"
                  placeholder={searchPlaceholder}
                  value={searchValue}
                  onChange={(event) => onSearchChange(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 sm:w-72"
                />
              </div>
            )}
            {renderTopToolbar?.()}
          </div>
        </div>
      )}

      <div
        className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
        aria-busy={loading}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {columns.map((column, index) => {
                  const sortable = Boolean(column.sortKey && onSortChange);
                  return (
                    <th key={index} className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
                      <button
                        type="button"
                        disabled={!sortable}
                        onClick={() => {
                          if (!column.sortKey || !onSortChange) return;
                          onSortChange(
                            column.sortKey,
                            sortBy === column.sortKey && sortOrder === 'asc' ? 'desc' : 'asc',
                          );
                        }}
                        className={getButtonClassName({
                          variant: 'ghost',
                          size: 'xs',
                          className: sortable
                            ? '-mx-2 uppercase tracking-wider'
                            : '-mx-2 cursor-default uppercase tracking-wider hover:bg-transparent',
                        })}
                      >
                        {column.header}
                        {sortBy === column.sortKey ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : null}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {data.length > 0 ? data.map((item, rowIndex) => (
                <tr key={keyExtractor?.(item) ?? rowIndex} className="bg-white transition-colors hover:bg-slate-50/50">
                  {columns.map((column, columnIndex) => (
                    <td key={columnIndex} className="px-6 py-4 text-slate-700">
                      {column.render
                        ? column.render(item)
                        : String(item[column.accessor as keyof T] ?? '')}
                    </td>
                  ))}
                </tr>
              )) : (
                <tr>
                  <td colSpan={columns.length} className="px-6 py-8 text-center text-slate-500">
                    {emptyText}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pagination && onPageChange && onPageSizeChange && (
        <Pagination {...pagination} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
      )}
    </div>
  );
};
