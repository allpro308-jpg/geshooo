import type { Project, ProjectStatus } from "@singulary/shared";
import { ExternalLink, Globe, Loader2, Play, Plug, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { projectsService } from "@/services/projects.service";
import { useProjectRuntimeStore } from "@/stores/project-runtime.store";

type PreviewTabProps = {
  project: Project;
};

export function PreviewTab({ project }: PreviewTabProps) {
  const runtime = useProjectRuntimeStore((state) => state.runtimeByProject[project.id]);
  const status: ProjectStatus = runtime?.status ?? project.lastStatus ?? "stopped";
  const ports = runtime?.detectedPorts ?? [];
  const exposedHints = runtime?.exposedPorts ?? [];
  const ipAddress = runtime?.ipAddress ?? null;

  const [selectedPort, setSelectedPort] = useState<number | null>(null);
  const [customPort, setCustomPort] = useState("");
  const [iframeKey, setIframeKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Auto-pick the first detected port when none is chosen yet.
  useEffect(() => {
    if (selectedPort != null) return;
    if (ports.length > 0) setSelectedPort(ports[0]);
  }, [ports, selectedPort]);

  // If the chosen port disappears (container restarted on a different port), drop the selection.
  useEffect(() => {
    if (selectedPort == null) return;
    if (status !== "running") return;
    if (ports.length === 0) return;
    if (!ports.includes(selectedPort)) setSelectedPort(ports[0]);
  }, [ports, selectedPort, status]);

  const [inputPath, setInputPath] = useState("/");
  const [activePath, setActivePath] = useState("/");

  const previewUrl = useMemo(
    () => {
      if (!selectedPort) return null;
      const base = runtime?.preview?.urlsByPort?.[selectedPort];
      if (!base) return null;
      // `base` always ends with `/`; activePath is `/...`.
      const safePath = activePath.startsWith("/") ? activePath.substring(1) : activePath;
      return base + safePath;
    },
    [runtime?.preview?.urlsByPort, selectedPort, activePath]
  );

  function commitPath() {
    let p = inputPath.trim();
    if (!p) p = "/";
    if (!p.startsWith("/")) p = "/" + p;
    setInputPath(p);
    setActivePath(p);
    setIframeKey((current) => current + 1);
  }

  async function start() {
    setBusy(true);
    try {
      await projectsService.runtimeAction(project.id, "start");
    } finally {
      setBusy(false);
    }
  }

  function commitCustomPort() {
    const value = Number(customPort);
    if (!Number.isFinite(value) || value < 1 || value > 65535) return;
    setSelectedPort(value);
    setCustomPort("");
    setIframeKey((current) => current + 1);
  }

  const ready = status === "running" && selectedPort != null && previewUrl != null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-hairline bg-bg/60 px-3 text-xs">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Globe size={13} className="text-accent shrink-0" />
          <PortPicker
            status={status}
            ports={ports}
            exposedHints={exposedHints}
            selected={selectedPort}
            onSelect={(port) => {
              setSelectedPort(port);
              setIframeKey((current) => current + 1);
            }}
          />
          <form 
            onSubmit={(e) => { e.preventDefault(); commitPath(); }}
            className="flex flex-1 items-center border border-line rounded-md bg-elevated overflow-hidden h-7"
          >
            <input 
              type="text" 
              value={inputPath}
              onChange={(e) => setInputPath(e.target.value)}
              onBlur={commitPath}
              placeholder="/"
              className="h-full w-full px-3 text-[12px] font-mono text-ink bg-transparent outline-none placeholder:text-dim"
            />
          </form>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setIframeKey((value) => value + 1)}
            disabled={!ready}
            className="focus-ring inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-muted transition-colors hover:bg-elevated hover:text-ink disabled:opacity-40"
          >
            <RefreshCw size={11} /> Reload
          </button>
          {previewUrl ? (
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className="focus-ring inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-muted transition-colors hover:bg-elevated hover:text-ink"
            >
              <ExternalLink size={11} /> Open
            </a>
          ) : null}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 bg-bg">
        {ready ? (
          <iframe
            key={iframeKey}
            ref={iframeRef}
            src={previewUrl!}
            title="Project preview"
            className="h-full w-full border-0 bg-white"
          />
        ) : (
          <PreviewEmpty
            status={status}
            ports={ports}
            busy={busy}
            onStart={() => void start()}
          />
        )}
      </div>
    </div>
  );
}

function PortPicker({
  status,
  ports,
  exposedHints,
  selected,
  onSelect
}: {
  status: ProjectStatus;
  ports: number[];
  exposedHints: number[];
  selected: number | null;
  onSelect: (port: number) => void;
}) {
  if (ports.length === 0) {
    return (
      <span className="font-mono text-[11px] text-dim">
        {status === "running"
          ? exposedHints.length > 0
            ? `Waiting for a listener on ${exposedHints.join(", ")}…`
            : "Scanning for ports…"
          : `No active port — status: ${status}`}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <select
        value={selected || ""}
        onChange={(e) => onSelect(Number(e.target.value))}
        className="focus-ring h-7 rounded-md border border-line bg-elevated px-2 font-mono text-[11px] text-ink outline-none"
      >
        {ports.map((port) => (
          <option key={port} value={port}>
            :{port}
          </option>
        ))}
      </select>
    </div>
  );
}

// CustomPort removed as requested

function PreviewEmpty({
  status,
  ports,
  busy,
  onStart
}: {
  status: ProjectStatus;
  ports: number[];
  busy: boolean;
  onStart: () => void;
}) {
  const running = status === "running";
  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-line bg-surface text-accent">
          {running ? <Loader2 size={20} className="animate-spin" /> : <Globe size={20} />}
        </div>
        <div className="mt-4 text-base font-semibold tracking-tightish text-ink">
          {running ? "Waiting for an open port…" : "Preview unavailable"}
        </div>
        <p className="mt-1 text-sm text-muted">
          {running
            ? "Singulary is scanning the container for a listening port. Make sure your dev server binds to 0.0.0.0."
            : "Start the project container to inspect open ports and load the preview."}
        </p>
        {!running ? (
          <button
            type="button"
            onClick={onStart}
            disabled={busy || status === "starting"}
            className="focus-ring mt-5 inline-flex h-9 items-center gap-2 rounded-lg border border-accent bg-accent px-3 text-sm font-medium text-white transition-colors hover:bg-pink-400 disabled:opacity-60"
          >
            <Play size={13} />
            {busy ? "Starting…" : status === "starting" ? "Starting…" : "Start project"}
          </button>
        ) : null}
        {ports.length === 0 && running ? (
          <div className="mt-4 text-[11px] text-dim">
            Tip: in your start command, ensure `--host 0.0.0.0` (or equivalent) is set.
          </div>
        ) : null}
      </div>
    </div>
  );
}
