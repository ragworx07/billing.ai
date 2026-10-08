import type { ReactNode } from 'react';

export function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-x-auto rounded-[var(--panel-radius)] border border-white/70 bg-[var(--panel-bg)] p-5 shadow-panel backdrop-blur">
      <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h2 className="min-w-0 font-display text-xl text-graphite">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
