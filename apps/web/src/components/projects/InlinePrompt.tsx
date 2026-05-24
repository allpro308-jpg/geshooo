import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";

type InlinePromptProps = {
  title: string;
  label?: string;
  initial?: string;
  placeholder?: string;
  submitLabel?: string;
  onSubmit: (value: string) => Promise<void> | void;
  onCancel: () => void;
};

export function InlinePrompt({
  title,
  label = "Name",
  initial = "",
  placeholder,
  submitLabel = "Save",
  onSubmit,
  onCancel
}: InlinePromptProps) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  async function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(trimmed);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-xl border border-line bg-elevated p-5 shadow-2xl shadow-black/50"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-base font-semibold tracking-tightish text-ink">{title}</h2>
        <div className="mt-4 grid gap-1.5">
          <label className="text-xs font-medium uppercase tracking-tightish text-muted">{label}</label>
          <input
            ref={ref}
            value={value}
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
              if (event.key === "Escape") onCancel();
            }}
            className="focus-ring h-10 rounded-lg border border-line bg-surface px-3 text-sm text-ink"
          />
        </div>
        {error ? (
          <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        ) : null}
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "Working…" : submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
