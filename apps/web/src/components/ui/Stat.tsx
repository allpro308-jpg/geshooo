type StatProps = {
  label: string;
  value: number | string;
  hint?: string;
};

export function Stat({ label, value, hint }: StatProps) {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-5 transition-colors hover:border-line">
      <div className="text-xs font-medium uppercase tracking-tightish text-dim">{label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tighter2 text-ink">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}
