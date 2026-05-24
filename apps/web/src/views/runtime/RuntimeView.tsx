import { TerminalSquare } from "lucide-react";

import { Section } from "@/components/ui/Section";

export function RuntimePage() {
  return (
    <div>
      <div className="mb-7">
        <div className="text-[10px] font-semibold uppercase tracking-tighter2 text-accent">Runtime</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tighter2 text-ink">Containers</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">Docker-backed project execution will attach here.</p>
      </div>
      <Section title="Runtime queue">
        <div className="rounded-xl border border-hairline bg-surface p-6">
          <div className="flex items-center gap-3 text-sm font-medium text-ink">
            <span className="grid h-8 w-8 place-items-center rounded-md border border-line bg-elevated text-accent">
              <TerminalSquare size={15} />
            </span>
            Container orchestration is ready for implementation
          </div>
          <p className="mt-3 max-w-2xl text-sm text-muted">
            The current container serves the platform itself. Project runtime containers, isolated workspace
            networks, log streaming, and preview forwarding are the next backend modules.
          </p>
        </div>
      </Section>
    </div>
  );
}
