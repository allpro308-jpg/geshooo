import type {
  ServiceCredential,
  ServiceDetail,
  ServiceLogLine,
  ServiceStatus
} from "@singulary/shared";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Database,
  Eye,
  EyeOff,
  Loader2,
  Network,
  Pause,
  Play,
  RefreshCw,
  Terminal,
  Trash2
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { WorkspaceLayout } from "@/components/layout/WorkspaceLayout";
import { Button } from "@/components/ui/Button";
import { workspacesService } from "@/services/workspaces.service";
import { errorMessage } from "@/utils/forms";

export function ServiceDetailPage() {
  const { id: workspaceId, serviceId } = useParams<{ id: string; serviceId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ServiceDetail | null>(null);
  const [logs, setLogs] = useState<ServiceLogLine[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const intervalRef = useRef<number | null>(null);

  async function loadDetail() {
    if (!serviceId) return;
    try {
      const response = await workspacesService.getServiceDetail(serviceId);
      setDetail(response);
    } catch (requestError) {
      setError(errorMessage(requestError, "Failed to load service."));
    }
  }

  async function loadLogs() {
    if (!serviceId) return;
    setLogsLoading(true);
    try {
      const response = await workspacesService.getServiceLogs(serviceId, 250);
      setLogs(response.lines);
    } catch (requestError) {
      setLogs([]);
      const message = errorMessage(requestError, "");
      if (message.includes("404")) return;
    } finally {
      setLogsLoading(false);
    }
  }

  useEffect(() => {
    if (!serviceId) return;
    void loadDetail();
    void loadLogs();

    intervalRef.current = window.setInterval(() => {
      void loadDetail();
    }, 6000);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [serviceId]);

  async function runAction(action: "start" | "stop" | "restart" | "destroy") {
    if (!serviceId) return;
    if (action === "destroy" && !window.confirm("Destroy this service? Container and volumes will be removed.")) {
      return;
    }
    setActionBusy(action);
    setError(null);
    try {
      await workspacesService.runServiceAction(serviceId, action);
      if (action === "destroy") {
        navigate(`/workspaces/${workspaceId}`);
        return;
      }
      await loadDetail();
      await loadLogs();
    } catch (requestError) {
      setError(errorMessage(requestError, "Action failed."));
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <WorkspaceLayout>
      <div className="mb-5">
        <button
          type="button"
          onClick={() => navigate(`/workspaces/${workspaceId}`)}
          className="focus-ring inline-flex items-center gap-1.5 rounded-md text-xs text-muted transition-colors hover:text-ink"
        >
          <ArrowLeft size={13} />
          Back to workspace
        </button>
      </div>

      {error ? (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          <AlertTriangle size={14} />
          {error}
        </div>
      ) : null}

      {!detail ? (
        <div className="grid place-items-center py-24 text-muted">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : (
        <>
          <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs text-dim">
                <Database size={12} className="text-accent" />
                <span className="uppercase tracking-tighter2">Service</span>
                <span>·</span>
                <span className="font-mono">{detail.service.slug}</span>
              </div>
              <h1 className="mt-1 text-3xl font-semibold tracking-tighter2 text-ink">
                {detail.service.name}
              </h1>
              <div className="mt-2 flex items-center gap-3 text-sm text-muted">
                <span>{detail.template?.name ?? detail.service.kind}</span>
                <span className="text-faint">·</span>
                <code className="font-mono text-xs">{detail.service.image}</code>
              </div>
            </div>
            <StatusBadge status={detail.runtime.status} />
          </header>

          <div className="mb-6 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Play size={13} />}
              disabled={detail.runtime.status === "running" || actionBusy !== null}
              onClick={() => void runAction("start")}
            >
              {actionBusy === "start" ? "Starting…" : "Start"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Pause size={13} />}
              disabled={detail.runtime.status !== "running" || actionBusy !== null}
              onClick={() => void runAction("stop")}
            >
              {actionBusy === "stop" ? "Stopping…" : "Stop"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={13} />}
              disabled={actionBusy !== null}
              onClick={() => void runAction("restart")}
            >
              {actionBusy === "restart" ? "Restarting…" : "Restart"}
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 size={13} />}
              disabled={actionBusy !== null}
              onClick={() => void runAction("destroy")}
            >
              {actionBusy === "destroy" ? "Destroying…" : "Destroy"}
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Connection">
              <Field label="URI" mono>
                {detail.connectionUri ? <SecretValue value={detail.connectionUri} censored /> : "—"}
              </Field>
              <Field label="Internal host" mono>
                <code>
                  {detail.service.internalHost}
                  {detail.service.internalPort ? `:${detail.service.internalPort}` : ""}
                </code>
              </Field>
              <Field
                label={
                  <span className="inline-flex items-center gap-1">
                    <Network size={11} />
                    Container IP
                  </span>
                }
                mono
              >
                <code>{detail.runtime.ipAddress ?? "—"}</code>
              </Field>
              {detail.service.connectionEnvKey ? (
                <Field label="Env key" mono>
                  <code>{detail.service.connectionEnvKey}</code>
                </Field>
              ) : null}
            </Panel>

            <Panel title="Credentials">
              {detail.credentials.length === 0 ? (
                <div className="text-sm text-muted">No credentials stored for this service.</div>
              ) : (
                <div className="grid gap-2">
                  {detail.credentials.map((credential) => (
                    <CredentialRow key={credential.key} credential={credential} />
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <Panel
            className="mt-4"
            title="Logs"
            action={
              <Button variant="ghost" size="sm" icon={<RefreshCw size={12} />} onClick={() => void loadLogs()}>
                Refresh
              </Button>
            }
          >
            <div className="max-h-[420px] overflow-auto rounded-lg border border-hairline bg-bg/60 p-3 font-mono text-[11px]">
              {logsLoading && logs.length === 0 ? (
                <div className="grid place-items-center py-6 text-muted">
                  <Loader2 size={16} className="animate-spin" />
                </div>
              ) : logs.length === 0 ? (
                <div className="flex items-center gap-2 px-2 py-1 text-dim">
                  <Terminal size={12} />
                  No logs yet.
                </div>
              ) : (
                logs.map((line, index) => (
                  <div key={index} className="whitespace-pre-wrap leading-relaxed">
                    {line.timestamp ? (
                      <span className="mr-2 text-dim">{line.timestamp.slice(11, 19)}</span>
                    ) : null}
                    <span className={line.stream === "stderr" ? "text-rose-300" : "text-muted"}>{line.text}</span>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </>
      )}
    </WorkspaceLayout>
  );
}

function Panel({
  title,
  action,
  children,
  className = ""
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-hairline bg-surface p-5 ${className}`}>
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-tightish text-muted">{title}</h2>
        {action}
      </header>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
  mono = false
}: {
  label: ReactNode;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <div className="text-[10px] font-semibold uppercase tracking-tighter2 text-dim">{label}</div>
      <div className={mono ? "font-mono text-xs text-ink" : "text-sm text-ink"}>{children}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: ServiceStatus }) {
  const colors = statusColors(status);
  return (
    <div className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 ${colors.border} ${colors.bg}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${colors.dot} ${colors.pulse}`} />
      <span className={`text-xs font-semibold uppercase tracking-tightish ${colors.text}`}>{status}</span>
    </div>
  );
}

function statusColors(status: ServiceStatus) {
  switch (status) {
    case "running":
      return {
        border: "border-green-400/30",
        bg: "bg-green-400/5",
        text: "text-green-300",
        dot: "bg-green-400",
        pulse: "animate-pulse"
      };
    case "creating":
    case "restarting":
    case "pending":
      return {
        border: "border-yellow-400/30",
        bg: "bg-yellow-400/5",
        text: "text-yellow-300",
        dot: "bg-yellow-400",
        pulse: "animate-pulse"
      };
    case "error":
      return {
        border: "border-danger/30",
        bg: "bg-danger/5",
        text: "text-danger",
        dot: "bg-rose-400",
        pulse: ""
      };
    case "stopped":
    case "exited":
      return {
        border: "border-line",
        bg: "bg-elevated",
        text: "text-muted",
        dot: "bg-dim",
        pulse: ""
      };
    default:
      return {
        border: "border-line",
        bg: "bg-elevated",
        text: "text-muted",
        dot: "bg-line2",
        pulse: ""
      };
  }
}

function SecretValue({ value, censored = false }: { value: string; censored?: boolean }) {
  const [reveal, setReveal] = useState(!censored);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  const display = censored && !reveal ? censorUri(value) : value;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-elevated px-3 py-2">
      <code className="flex-1 truncate font-mono text-xs text-ink">{display}</code>
      <div className="flex items-center gap-1">
        {censored ? (
          <button
            type="button"
            onClick={() => setReveal((current) => !current)}
            className="focus-ring grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            {reveal ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        ) : null}
        <button
          type="button"
          onClick={copy}
          className="focus-ring grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink"
        >
          {copied ? <Check size={13} className="text-accent" /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
}

function censorUri(uri: string): string {
  return uri.replace(/:\/\/([^:]+):([^@]+)@/, (_match, user) => `://${user}:••••••@`);
}

function CredentialRow({ credential }: { credential: ServiceCredential }) {
  const [reveal, setReveal] = useState(!credential.secret);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(credential.value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  return (
    <div className="grid gap-1 rounded-lg border border-line bg-elevated px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-tighter2 text-dim">{credential.label}</div>
      <div className="flex items-center justify-between gap-2">
        <code className="truncate font-mono text-sm text-ink">
          {credential.secret && !reveal ? "•".repeat(12) : credential.value}
        </code>
        <div className="flex items-center gap-1">
          {credential.secret ? (
            <button
              type="button"
              onClick={() => setReveal((current) => !current)}
              className="focus-ring grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              {reveal ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          ) : null}
          <button
            type="button"
            onClick={copy}
            className="focus-ring grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            {copied ? <Check size={13} className="text-accent" /> : <Copy size={13} />}
          </button>
        </div>
      </div>
    </div>
  );
}
