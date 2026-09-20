import { Skeleton } from './Skeleton';

interface TableSkeletonProps {
  columns?: number;
  rows?: number;
  showToolbar?: boolean;
  showPagination?: boolean;
  label?: string;
}

const cellWidths = ['w-24', 'w-36', 'w-28', 'w-32', 'w-20', 'w-16'];

export const TableSkeleton = ({
  columns = 5,
  rows = 6,
  showToolbar = true,
  showPagination = true,
  label = 'Đang tải dữ liệu',
}: TableSkeletonProps) => (
  <div
    role="status"
    aria-live="polite"
    aria-label={label}
    className="w-full space-y-4"
  >
    {showToolbar && (
      <div aria-hidden="true" className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Skeleton className="h-10 w-full sm:w-72" />
          <Skeleton className="h-10 w-full sm:w-40" />
        </div>
      </div>
    )}

    <div
      aria-hidden="true"
      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] border-collapse text-left text-sm lg:min-w-[750px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              {Array.from({ length: columns }, (_, index) => (
                <th key={index} className="px-3.5 py-2.5">
                  <Skeleton className={`h-3 ${cellWidths[index % cellWidths.length]}`} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {Array.from({ length: rows }, (_, rowIndex) => (
              <tr key={rowIndex}>
                {Array.from({ length: columns }, (__, columnIndex) => (
                  <td key={columnIndex} className="px-3.5 py-2.5">
                    <Skeleton
                      className={`h-4 ${
                        cellWidths[(rowIndex + columnIndex) % cellWidths.length]
                      }`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>

    {showPagination && (
      <div aria-hidden="true" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-5 w-40" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-20" />
        </div>
      </div>
    )}
  </div>
);
