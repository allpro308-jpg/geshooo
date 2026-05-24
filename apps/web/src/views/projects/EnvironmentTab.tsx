import type { ProjectEnvVar } from "@singulary/shared";
import { Check, Copy, Eye, EyeOff, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/FormField";
import { projectsService } from "@/services/projects.service";
import { errorMessage } from "@/utils/forms";

export function EnvironmentTab({ projectId }: { projectId: string }) {
  const [vars, setVars] = useState<ProjectEnvVar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<{ key: string; value: string; isSecret: boolean }>({
    key: "",
    value: "",
    isSecret: true
  });
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const response = await projectsService.listEnv(projectId);
      setVars(response.vars);
    } catch (requestError) {
      setError(errorMessage(requestError, "Failed to load environment."));
    }
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  async function submit() {
    if (!draft.key.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await projectsService.createEnv(projectId, {
        key: draft.key.trim().toUpperCase(),
        value: draft.value,
        isSecret: draft.isSecret
      });
      setDraft({ key: "", value: "", isSecret: true });
      setCreating(false);
      await load();
    } catch (requestError) {
      setError(errorMessage(requestError, "Failed to create env var."));
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(envId: string) {
    if (!window.confirm("Delete this env var?")) return;
    setError(null);
    try {
      await projectsService.deleteEnv(projectId, envId);
      await load();
    } catch (requestError) {
      setError(errorMessage(requestError, "Failed to delete env var."));
    }
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold tracking-tightish text-ink">Environment variables</h2>
          <p className="mt-1 text-sm text-muted">
            Project-scoped variables injected when the runtime starts. Secret values are write-only after creation.
          </p>
        </div>
        {!creating ? (
          <Button icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            Add variable
          </Button>
        ) : null}
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</div>
      ) : null}

      {creating ? (
        <div className="mb-4 rounded-xl border border-line bg-surface p-4">
          <div className="grid gap-3 sm:grid-cols-[200px_1fr_auto]">
            <TextInput
              label="Key"
              value={draft.key}
              onChange={(event) => setDraft({ ...draft, key: event.target.value.toUpperCase() })}
              placeholder="DATABASE_URL"
            />
            <TextInput
              label="Value"
              value={draft.value}
              type={draft.isSecret ? "password" : "text"}
              onChange={(event) => setDraft({ ...draft, value: event.target.value })}
            />
            <div className="flex items-end gap-2">
              <label className="flex h-10 items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={draft.isSecret}
                  onChange={(event) => setDraft({ ...draft, isSecret: event.target.checked })}
                />
                Secret
              </label>
              <Button onClick={submit} disabled={submitting}>
                {submitting ? "Saving…" : "Save"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setCreating(false);
                  setDraft({ key: "", value: "", isSecret: true });
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {!vars ? (
        <div className="grid place-items-center py-12 text-muted">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : vars.length === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-line bg-surface p-10 text-center">
          <Lock size={18} className="text-dim" />
          <div className="mt-3 text-sm text-ink">No environment variables yet</div>
          <div className="mt-1 max-w-sm text-xs text-muted">
            Set keys like <code className="font-mono text-accent">DATABASE_URL</code> here. They are encrypted at rest
            and only injected at runtime.
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-hairline bg-surface">
          <ul className="divide-y divide-hairline">
            {vars.map((entry) => (
              <EnvRow key={entry.id} entry={entry} onDelete={() => void remove(entry.id)} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function EnvRow({ entry, onDelete }: { entry: ProjectEnvVar; onDelete: () => void }) {
  const [reveal, setReveal] = useState(!entry.isSecret);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!entry.value) return;
    try {
      await navigator.clipboard.writeText(entry.value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <code className="font-mono text-sm text-ink">{entry.key}</code>
          {entry.isSecret ? (
            <span className="rounded-full border border-accent/30 bg-accentSoft px-1.5 py-0.5 text-[9px] uppercase tracking-tighter2 text-accent">
              secret
            </span>
          ) : null}
        </div>
        <div className="mt-1 font-mono text-xs text-muted">
          {entry.isSecret && entry.value === null
            ? "Value hidden after creation"
            : reveal
              ? entry.value
              : "•".repeat(12)}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {!entry.isSecret && entry.value !== null ? (
          <button
            type="button"
            onClick={() => setReveal((value) => !value)}
            className="focus-ring grid h-8 w-8 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            {reveal ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        ) : null}
        {entry.value ? (
          <button
            type="button"
            onClick={copy}
            className="focus-ring grid h-8 w-8 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            {copied ? <Check size={13} className="text-accent" /> : <Copy size={13} />}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDelete}
          className="focus-ring grid h-8 w-8 place-items-center rounded-md text-dim transition-colors hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </li>
  );
}
