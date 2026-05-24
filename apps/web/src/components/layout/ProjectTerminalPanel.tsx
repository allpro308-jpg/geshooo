import type { Project, ProjectLogLine, ProjectShell } from "@singulary/shared";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Plus, RefreshCw, TerminalSquare, Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { projectsService } from "@/services/projects.service";
import { authenticatedWsUrl } from "@/services/ws";
import { useProjectRuntimeStore } from "@/stores/project-runtime.store";

import "@xterm/xterm/css/xterm.css";

type Tab = "logs" | `shell:${string}`;

type ProjectTerminalPanelProps = {
  project: Project;
};

export function ProjectTerminalPanel({ project }: ProjectTerminalPanelProps) {
  const open = useProjectRuntimeStore((state) => state.terminalOpen);
  const close = useProjectRuntimeStore((state) => state.closeTerminal);
  const runtime = useProjectRuntimeStore((state) => state.runtimeByProject[project.id]);
  const logs = useProjectRuntimeStore((state) => state.logsByProject[project.id]);

  const shells = useProjectRuntimeStore((state) => state.shellsByProject[project.id]) ?? [];
  const [active, setActive] = useState<Tab>("logs");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setShellsInStore = useProjectRuntimeStore((state) => state.setShells);

  const [height, setHeight] = useState(() => {
    if (typeof window === "undefined") return 320;
    const stored = window.localStorage.getItem("singulary:terminal:height");
    return stored ? Math.max(180, Math.min(720, Number(stored))) : 320;
  });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("singulary:terminal:height", String(height));
  }, [height]);

  useEffect(() => {
    if (!dragging) return;
    function onMove(event: MouseEvent) {
      const next = window.innerHeight - event.clientY;
      setHeight(Math.max(180, Math.min(window.innerHeight - 140, next)));
    }
    function onUp() {
      setDragging(false);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  useEffect(() => {
    if (!open) return;
    if (active !== "logs" && !shells.some((shell) => `shell:${shell.id}` === active)) {
      setActive("logs");
    }
  }, [active, shells, open]);

  async function openShell() {
    setBusy(true);
    setError(null);
    try {
      const response = await projectsService.createShell(project.id);
      // The events stream will broadcast the new shell list; setting it here
      // makes the UI feel instant without waiting for the round-trip.
      setShellsInStore(project.id, [...shells, response.shell]);
      setActive(`shell:${response.shell.id}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not open shell.");
    } finally {
      setBusy(false);
    }
  }

  async function closeShell(shellId: string) {
    try {
      await projectsService.closeShell(project.id, shellId);
    } catch {
      // ignore — events stream will reconcile
    }
    setShellsInStore(
      project.id,
      shells.filter((shell) => shell.id !== shellId)
    );
    if (active === `shell:${shellId}`) setActive("logs");
  }

  if (!open) return null;

  const canOpenShell = runtime?.status === "running";

  return (
    <div
      className="flex shrink-0 flex-col border-t border-hairline bg-bg"
      style={{ height: `${height}px` }}
    >
      <div
        onMouseDown={() => setDragging(true)}
        className={`h-1 cursor-row-resize bg-transparent transition-colors hover:bg-accent/40 ${
          dragging ? "bg-accent/60" : ""
        }`}
      />
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-hairline pl-2 pr-3 text-xs">
        <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
          <TabButton active={active === "logs"} onClick={() => setActive("logs")}>
            <span>Logs</span>
          </TabButton>
          {shells.map((shell) => {
            const tab: Tab = `shell:${shell.id}`;
            return (
              <ShellTabButton
                key={shell.id}
                shell={shell}
                active={active === tab}
                onSelect={() => setActive(tab)}
                onClose={() => void closeShell(shell.id)}
              />
            );
          })}
          <button
            type="button"
            onClick={() => void openShell()}
            disabled={!canOpenShell || busy}
            title={canOpenShell ? "Open new shell" : "Start the project to open a shell"}
            className="focus-ring ml-1 grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus size={13} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {error ? <span className="hidden text-danger sm:inline">{error}</span> : null}
          {active === "logs" ? (
            <button
              type="button"
              onClick={() => void projectsService.clearLogs(project.id)}
              className="focus-ring inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-muted transition-colors hover:bg-elevated hover:text-ink"
            >
              <Trash2 size={11} /> Clear
            </button>
          ) : null}
          <button
            type="button"
            onClick={close}
            title="Hide terminal"
            className="focus-ring grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            <X size={13} />
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div className={active === "logs" ? "absolute inset-0" : "absolute inset-0 hidden"}>
          <LogsView lines={logs ?? []} />
        </div>
        {shells.map((shell) => {
          const tab: Tab = `shell:${shell.id}`;
          return (
            <div
              key={shell.id}
              className={tab === active ? "absolute inset-0" : "absolute inset-0 hidden"}
            >
              <ShellView projectId={project.id} shell={shell} visible={tab === active} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`focus-ring h-7 rounded-md px-2.5 text-[11px] font-medium uppercase tracking-tightish transition-colors ${
        active ? "bg-elevated text-ink" : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function ShellTabButton({
  shell,
  active,
  onSelect,
  onClose
}: {
  shell: ProjectShell;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className={`flex h-7 items-center rounded-md transition-colors ${
        active ? "bg-elevated text-ink" : "text-muted hover:bg-elevated/60 hover:text-ink"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="focus-ring flex h-7 items-center gap-1.5 rounded-l-md px-2 text-[11px] font-medium"
      >
        <TerminalSquare size={11} className="text-accent" />
        <span>{shell.label}</span>
        {shell.status === "exited" ? (
          <span className="rounded-full bg-danger/15 px-1.5 py-0.5 text-[9px] uppercase tracking-tighter2 text-danger">
            exited
          </span>
        ) : null}
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        title="Close shell"
        className="focus-ring grid h-7 w-6 place-items-center rounded-r-md text-dim transition-colors hover:bg-raised hover:text-ink"
      >
        <X size={10} />
      </button>
    </div>
  );
}

function LogsView({ lines }: { lines: ProjectLogLine[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length]);

  if (lines.length === 0) {
    return (
      <div className="grid h-full place-items-center text-xs text-dim">
        No log lines yet. Start the project to see output.
      </div>
    );
  }

  return (
    <div ref={ref} className="h-full overflow-auto bg-bg px-3 py-2 font-mono text-[11px] leading-relaxed">
      {lines.map((line, index) => (
        <div key={index} className="whitespace-pre-wrap">
          <span className="mr-2 text-dim">{line.timestamp.slice(11, 19)}</span>
          <span className={levelClass(line.level)}>{line.text}</span>
        </div>
      ))}
    </div>
  );
}

function levelClass(level: ProjectLogLine["level"]): string {
  switch (level) {
    case "error":
      return "text-rose-300";
    case "warn":
      return "text-yellow-300";
    default:
      return "text-muted";
  }
}

function ShellView({
  projectId,
  shell,
  visible
}: {
  projectId: string;
  shell: ProjectShell;
  visible: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected" | "error">(
    "connecting"
  );

  // Build the terminal once per shell ID and keep it mounted so output isn't lost on tab swaps.
  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "JetBrains Mono, ui-monospace, monospace",
      fontSize: 12,
      lineHeight: 1.3,
      convertEol: true,
      theme: {
        background: "#070708",
        foreground: "#fafafa",
        cursor: "#ec4899",
        cursorAccent: "#070708",
        selectionBackground: "rgba(236,72,153,0.35)",
        black: "#0f0f11",
        red: "#f43f5e",
        green: "#34d399",
        yellow: "#f59e0b",
        blue: "#60a5fa",
        magenta: "#ec4899",
        cyan: "#22d3ee",
        white: "#fafafa",
        brightBlack: "#56565f"
      }
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    if (containerRef.current) {
      term.open(containerRef.current);
      try {
        fit.fit();
      } catch {
        // ignore
      }
    }
    termRef.current = term;
    fitRef.current = fit;

    let disposed = false;
    void authenticatedWsUrl(`/api/ws/projects/${projectId}/shells/${shell.id}`)
      .then((url) => {
        if (disposed) return;
        const ws = new WebSocket(url);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;

        ws.addEventListener("open", () => {
          setStatus("connected");
          try {
            ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
          } catch {
            // ignore
          }
        });
        ws.addEventListener("message", (event) => {
          const data = event.data;
          if (data instanceof ArrayBuffer) {
            term.write(new Uint8Array(data));
          } else if (typeof data === "string") {
            if (data.startsWith("{")) {
              try {
                const parsed = JSON.parse(data) as { type: string; message?: string };
                if (parsed.type === "exit") {
                  term.writeln(`\x1b[31m\r\n[singulary] ${parsed.message ?? "Shell exited."}\x1b[0m`);
                  return;
                }
                if (parsed.type === "error" && parsed.message) {
                  term.writeln(`\x1b[31m[singulary] ${parsed.message}\x1b[0m`);
                  return;
                }
              } catch {
                // fall through
              }
            }
            term.write(data);
          }
        });
        ws.addEventListener("close", () => setStatus("disconnected"));
        ws.addEventListener("error", () => setStatus("error"));
      })
      .catch(() => {
        if (!disposed) setStatus("error");
      });

    const dataDisposable = term.onData((data) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(data);
    });

    const observer = new ResizeObserver(() => {
      if (!visible) return;
      try {
        fit.fit();
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      } catch {
        // ignore
      }
    });
    if (containerRef.current) observer.observe(containerRef.current);

    return () => {
      disposed = true;
      dataDisposable.dispose();
      observer.disconnect();
      wsRef.current?.close();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  }, [projectId, shell.id]);

  // Re-fit and focus when this tab becomes visible.
  useEffect(() => {
    if (!visible) return;
    const term = termRef.current;
    const fit = fitRef.current;
    const ws = wsRef.current;
    if (!term || !fit) return;
    try {
      fit.fit();
      term.focus();
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    } catch {
      // ignore
    }
  }, [visible]);

  return (
    <div className="relative h-full bg-bg">
      <div ref={containerRef} className="absolute inset-0 px-2 py-2" />
      {status !== "connected" ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 px-3 py-2 text-[11px] text-dim">
          {status === "connecting" ? (
            <>
              <RefreshCw size={11} className="animate-spin" /> Connecting to {shell.label}…
            </>
          ) : null}
          {status === "disconnected" ? "Disconnected — reopen the shell to reconnect." : null}
          {status === "error" ? "Connection failed. Make sure the container is running." : null}
        </div>
      ) : null}
    </div>
  );
}
