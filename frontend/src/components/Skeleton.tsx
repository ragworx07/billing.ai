import clsx from 'clsx';

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rounded' | 'rectangular';
  width?: string | number;
  height?: string | number;
}

export function Skeleton({
  className,
  variant = 'rounded',
  width,
  height,
}: SkeletonProps) {
  const variantClasses = {
    text: 'rounded-md h-4 w-full',
    circular: 'rounded-full',
    rounded: 'rounded-xl',
    rectangular: 'rounded-none',
  };

  return (
    <div
      className={clsx('yt-skeleton', variantClasses[variant], className)}
      style={{
        width: width !== undefined ? width : undefined,
        height: height !== undefined ? height : undefined,
      }}
    />
  );
}

export function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm space-y-4"
        >
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-28 rounded-lg" />
            <Skeleton className="h-10 w-10 rounded-xl" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-8 w-36 rounded-xl" />
            <Skeleton className="h-3 w-24 rounded-md" />
          </div>
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
            <Skeleton className="h-3 w-20 rounded-md" />
            <Skeleton className="h-3 w-12 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({
  rows = 6,
  columns = 6,
  showHeader = true,
}: {
  rows?: number;
  columns?: number;
  showHeader?: boolean;
}) {
  const colWidths = ['w-36', 'w-28', 'w-20', 'w-24', 'w-16', 'w-32'];

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      {showHeader && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-60 rounded-xl" />
            <Skeleton className="h-9 w-24 rounded-xl" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-24 rounded-xl" />
            <Skeleton className="h-9 w-20 rounded-xl" />
            <Skeleton className="h-9 w-9 rounded-xl" />
          </div>
        </div>
      )}
      <div className="p-4 space-y-3">
        {/* Table Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 px-2">
          {Array.from({ length: columns }).map((_, colIdx) => (
            <Skeleton
              key={colIdx}
              className={clsx(
                'h-4 rounded-md',
                colIdx === 0 ? 'w-28' : colIdx === columns - 1 ? 'w-16' : 'w-20'
              )}
            />
          ))}
        </div>
        {/* Table Rows with realistic YouTube-like variable widths */}
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div
            key={rowIdx}
            className="flex items-center justify-between py-3 px-2 border-b border-slate-100/60 last:border-0"
          >
            {Array.from({ length: columns }).map((_, colIdx) => (
              <Skeleton
                key={colIdx}
                className={clsx(
                  'h-4 rounded-md',
                  colIdx === 0
                    ? 'w-36'
                    : colIdx === 1
                    ? colWidths[(rowIdx + 1) % colWidths.length]
                    : colIdx === columns - 1
                    ? 'w-14'
                    : 'w-20'
                )}
              />
            ))}
          </div>
        ))}
      </div>
      {/* Table Footer */}
      <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/40 px-5 py-3">
        <Skeleton className="h-4 w-32 rounded-md" />
        <Skeleton className="h-4 w-40 rounded-md" />
      </div>
    </div>
  );
}

export function ProjectViewSkeleton() {
  return (
    <div className="space-y-5 animate-fade-in">
      {/* Top Banner / Workspace Bar */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div>
              <Skeleton className="h-7 w-56 rounded-xl" />
              <Skeleton className="h-3 w-40 rounded-md mt-1.5" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full ml-2" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-24 rounded-xl" />
            <Skeleton className="h-9 w-24 rounded-xl" />
            <Skeleton className="h-9 w-28 rounded-xl" />
          </div>
        </div>

        {/* 4 Cards Summary Row */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 pt-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 space-y-2">
              <Skeleton className="h-3 w-24 rounded-md" />
              <Skeleton className="h-7 w-32 rounded-lg" />
              <Skeleton className="h-2 w-20 rounded-md" />
            </div>
          ))}
        </div>

        {/* Tabs Bar */}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <Skeleton className="h-9 w-24 rounded-xl" />
          <Skeleton className="h-9 w-24 rounded-xl" />
          <Skeleton className="h-9 w-24 rounded-xl" />
          <Skeleton className="h-9 w-24 rounded-xl" />
          <Skeleton className="h-9 w-24 rounded-xl" />
        </div>
      </div>

      {/* Main Tab Content Table Skeleton */}
      <TableSkeleton rows={7} columns={7} />
    </div>
  );
}

export function PageSkeleton({
  title = true,
  cards = 4,
  tableRows = 6,
}: {
  title?: boolean;
  cards?: number;
  tableRows?: number;
}) {
  return (
    <div className="space-y-6">
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-8 w-52 rounded-xl" />
            <Skeleton className="h-4 w-72 rounded-md" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-10 w-32 rounded-xl" />
            <Skeleton className="h-10 w-28 rounded-xl" />
          </div>
        </div>
      )}

      {cards > 0 && <CardSkeleton count={cards} />}

      {tableRows > 0 && <TableSkeleton rows={tableRows} />}
    </div>
  );
}

export function AnalyticsSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-60 rounded-xl" />
          <Skeleton className="h-4 w-80 rounded-md" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-36 rounded-xl" />
          <Skeleton className="h-10 w-10 rounded-xl" />
        </div>
      </div>

      {/* 4 Cards */}
      <CardSkeleton count={4} />

      {/* Charts Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Bar Chart Placeholder */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-44 rounded-lg" />
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
          {/* Animated vertical bar pillars like YouTube Analytics */}
          <div className="h-64 flex items-end justify-between gap-3 pt-6 pb-2 px-4 border-b border-slate-100">
            {Array.from({ length: 12 }).map((_, idx) => {
              const heights = ['h-36', 'h-48', 'h-24', 'h-56', 'h-40', 'h-52', 'h-32', 'h-60', 'h-44', 'h-52', 'h-28', 'h-48'];
              return (
                <div key={idx} className="flex-1 flex flex-col items-center gap-2">
                  <Skeleton className={clsx('w-full rounded-t-lg', heights[idx % heights.length])} />
                  <Skeleton className="h-3 w-8 rounded-md" />
                </div>
              );
            })}
          </div>
        </div>

        {/* Donut / Mix Chart Placeholder */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-44 rounded-lg" />
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
          <div className="h-64 flex items-center justify-center gap-8">
            <Skeleton className="h-48 w-48 rounded-full border-[18px] border-slate-200/80" />
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <Skeleton className="h-4 w-28 rounded-md" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
