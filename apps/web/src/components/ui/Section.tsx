import type { ReactNode } from "react";

type SectionProps = {
  title?: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
};

export function Section({ title, description, children, actions, compact = false }: SectionProps) {
  return (
    <section className={compact ? "py-4" : "py-6"}>
      {title || actions ? (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          {title ? (
            <div>
              <h2 className="text-sm font-medium uppercase tracking-tightish text-muted">{title}</h2>
              {description ? (
                <p className="mt-1 max-w-2xl text-sm text-dim">{description}</p>
              ) : null}
            </div>
          ) : <div />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}
