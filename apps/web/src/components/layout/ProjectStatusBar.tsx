import type { Project, ProjectStatus } from "@singulary/shared";
import {
  AlertCircle,
  AlertTriangle,
  Circle,
  Info,
  Pause,
  Play,
  RefreshCw,
  TerminalSquare,
  Users,
  X
} from "lucide-react";
import { useEffect, useState } from "react";

import { projectsService } from "@/services/projects.service";
import { useProjectRuntimeStore } from "@/stores/project-runtime.store";

type ProjectStatusBarProps = {
  project: Project;
};

export function ProjectStatusBar({ project }: ProjectStatusBarProps) {
  const runtime = useProjectRuntimeStore((state) => state.runtimeByProject[project.id]);
  const stats = useProjectRuntimeStore((state) => state.statsByProject[project.id]);
  const presence = useProjectRuntimeStore((state) => state.presenceByProject[project.id]);
  const terminalOpen = useProjectRuntimeStore((state) => state.terminalOpen);
  const setRuntime = useProjectRuntimeStore((state) => state.setRuntime);
  const toggleTerminal = useProjectRuntimeStore((state) => state.toggleTerminal);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Runtime, logs, and presence arrive over the events WebSocket
  // (see useProjectEvents in WorkspaceLayout). No polling here.

  async function action(kind: "start" | "stop" | "restart") {
    setBusy(kind);
    setError(null);
    try {
      const response = await projectsService.runtimeAction(project.id, kind);
      setRuntime(project.id, response.runtime);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  const status: ProjectStatus = runtime?.status ?? project.lastStatus ?? "stopped";
  const running = status === "running";

  return (
    <div className="flex h-9 shrink-0 items-center justify-between border-t border-hairline bg-elevated/90 px-3 text-xs backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-2">
        <StatusPill status={status} />
        <div className="ml-1 flex items-center gap-0.5">
          <IconButton
            label="Start"
            disabled={running || busy !== null}
            onClick={() => void action("start")}
            busy={busy === "start"}
            icon={<Play size={12} />}
          />
          <IconButton
            label="Stop"
            disabled={!running || busy !== null}
            onClick={() => void action("stop")}
            busy={busy === "stop"}
            icon={<Pause size={12} />}
          />
          <IconButton
            label="Restart"
            disabled={!runtime?.containerId || busy !== null}
            onClick={() => void action("restart")}
            busy={busy === "restart"}
            icon={<RefreshCw size={12} />}
          />
        </div>
        {runtime?.ipAddress ? (
          <span className="ml-2 hidden font-mono text-[11px] text-dim sm:inline">
            {runtime.ipAddress}
            {runtime.detectedPorts.length > 0 ? `:${runtime.detectedPorts.join(",")}` : ""}
          </span>
        ) : null}
        {presence && presence.clients > 1 ? (
          <span
            className="ml-2 inline-flex items-center gap-1 rounded-full border border-line bg-elevated px-1.5 py-0.5 text-[10px] text-muted"
            title={`${presence.clients} clients connected`}
          >
            <Users size={10} />
            {presence.clients}
          </span>
        ) : null}
        <IdleCountdown idleUntilEpochMs={presence?.idleUntilEpochMs ?? null} />
        {error ? <span className="ml-2 truncate text-danger">{error}</span> : null}
      </div>

      <button
        type="button"
        onClick={toggleTerminal}
        className="focus-ring group flex h-7 items-center gap-2 rounded-md px-2 text-muted transition-colors hover:bg-raised hover:text-ink"
      >
        <span className="flex items-center gap-2">
          <Counter
            icon={<AlertCircle size={11} />}
            value={stats?.error ?? 0}
            tone="text-rose-300"
            label="errors"
          />
          <Counter
            icon={<AlertTriangle size={11} />}
            value={stats?.warn ?? 0}
            tone="text-yellow-300"
            label="warnings"
          />
          <Counter
            icon={<Info size={11} />}
            value={stats?.info ?? 0}
            tone="text-muted"
            label="info"
          />
        </span>
        <span className="h-3 w-px bg-line" />
        <span className="flex items-center gap-1.5">
          {terminalOpen ? <X size={12} /> : <TerminalSquare size={12} />}
          <span className="hidden sm:inline">{terminalOpen ? "Close" : "Terminal"}</span>
        </span>
      </button>
    </div>
  );
}

function StatusPill({ status }: { status: ProjectStatus }) {
  const tone = statusTone(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-tighter2 ${tone.border} ${tone.bg} ${tone.text}`}
      title={status}
    >
      <Circle
        size={6}
        className={`${tone.dot} ${tone.pulse}`}
        fill="currentColor"
        strokeWidth={0}
      />
      {status}
    </span>
  );
}

function statusTone(status: ProjectStatus) {
  switch (status) {
    case "running":
      return {
        border: "border-green-400/30",
        bg: "bg-green-400/5",
        text: "text-green-300",
        dot: "text-green-400",
        pulse: "animate-pulse"
      };
    case "starting":
    case "installing":
      return {
        border: "border-yellow-400/30",
        bg: "bg-yellow-400/5",
        text: "text-yellow-300",
        dot: "text-yellow-400",
        pulse: "animate-pulse"
      };
    case "error":
      return {
        border: "border-danger/30",
        bg: "bg-danger/5",
        text: "text-danger",
        dot: "text-rose-400",
        pulse: ""
      };
    case "exited":
    case "stopped":
      return {
        border: "border-line",
        bg: "bg-bg",
        text: "text-muted",
        dot: "text-dim",
        pulse: ""
      };
    default:
      return {
        border: "border-line",
        bg: "bg-bg",
        text: "text-muted",
        dot: "text-line2",
        pulse: ""
      };
  }
}

function IconButton({
  label,
  icon,
  disabled,
  busy,
  onClick
}: {
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="focus-ring grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy ? <RefreshCw size={11} className="animate-spin" /> : icon}
    </button>
  );
}

function Counter({
  icon,
  value,
  tone,
  label
}: {
  icon: React.ReactNode;
  value: number;
  tone: string;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1 font-mono text-[11px]" title={label}>
      <span className={tone}>{icon}</span>
      <span>{value}</span>
    </span>
  );
}

function IdleCountdown({ idleUntilEpochMs }: { idleUntilEpochMs: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (idleUntilEpochMs == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [idleUntilEpochMs]);

  if (idleUntilEpochMs == null) return null;
  const remaining = Math.max(0, idleUntilEpochMs - now);
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return (
    <span
      className="ml-2 inline-flex items-center gap-1 rounded-full border border-yellow-400/30 bg-yellow-400/5 px-1.5 py-0.5 font-mono text-[10px] text-yellow-300"
      title="Container will auto-stop when no clients are connected"
    >
      stop in {minutes}:{seconds.toString().padStart(2, "0")}
    </span>
  );
}
