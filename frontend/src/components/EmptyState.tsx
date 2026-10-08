export function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-steel bg-mist p-8 text-center">
      <p className="font-display text-lg text-graphite">{title}</p>
      <p className="mt-2 text-sm text-slate">{subtitle}</p>
    </div>
  );
}
