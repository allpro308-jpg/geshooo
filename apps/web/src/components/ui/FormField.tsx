import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

const baseField =
  "h-10 w-full rounded-lg border border-line bg-elevated px-3 text-sm font-normal text-ink transition-colors placeholder:text-dim hover:border-line2 focus:border-accent/60 focus:bg-surface";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
};

export function TextInput({ label, className = "", ...props }: InputProps) {
  if (!label) {
    return (
      <input
        className={`focus-ring ${baseField} ${className}`}
        {...props}
      />
    );
  }

  return (
    <label className="grid gap-1.5 text-xs font-medium uppercase tracking-tightish text-muted">
      <span>{label}</span>
      <input
        className={`focus-ring ${baseField} ${className}`}
        {...props}
      />
    </label>
  );
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
};

export function Textarea({ label, className = "", ...props }: TextareaProps) {
  if (!label) {
    return (
      <textarea
        className={`focus-ring min-h-24 rounded-lg border border-line bg-elevated px-3 py-2 text-sm font-normal text-ink transition-colors placeholder:text-dim hover:border-line2 focus:border-accent/60 focus:bg-surface ${className}`}
        {...props}
      />
    );
  }
  return (
    <label className="grid gap-1.5 text-xs font-medium uppercase tracking-tightish text-muted">
      <span>{label}</span>
      <textarea
        className={`focus-ring min-h-24 rounded-lg border border-line bg-elevated px-3 py-2 text-sm font-normal text-ink transition-colors placeholder:text-dim hover:border-line2 focus:border-accent/60 focus:bg-surface ${className}`}
        {...props}
      />
    </label>
  );
}

export const selectClass =
  "focus-ring h-10 w-full rounded-lg border border-line bg-elevated px-3 text-sm font-normal text-ink transition-colors hover:border-line2 focus:border-accent/60";
