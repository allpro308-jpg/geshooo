import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import type {
  Snapshot,
  SnapshotDiff,
  SnapshotDiffEntry,
  SnapshotKind
} from "@singulary/shared";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Camera,
  CornerUpLeft,
  FileDiff,
  History,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import type * as Monaco from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { projectsService } from "@/services/projects.service";
import { errorMessage } from "@/utils/forms";

type SnapshotsTabProps = {
  projectId: string;
};

type FilePair = {
  before: string;
  after: string;
  binary: boolean;
};

type ChangedStatus = Exclude<SnapshotDiffEntry["status"], "unchanged">;

const STATUS_LABEL: Record<SnapshotDiffEntry["status"], string> = {
  added: "مُضاف",
  removed: "محذوف",
  modified: "مُعدّل",
  unchanged: "بدون تغيير"
};

const STATUS_STYLES: Record<SnapshotDiffEntry["status"], string> = {
  added: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  removed: "border-danger/30 bg-danger/10 text-danger",
  modified: "border-accent/30 bg-accentSoft text-accent",
  unchanged: "border-hairline bg-elevated text-dim"
};

const KIND_LABEL: Record<SnapshotKind, string> = {
  manual: "يدوي",
  agent_pre_write: "وكيل قبل الكتابة",
  agent_batch: "دفعة الوكيل",
  before_command: "قبل الأمر",
  checkpoint: "نقطة تحقق",
  rollback: "تراجع"
};

const KIND_ICON: Record<SnapshotKind, JSX.Element> = {
  manual: <Camera size={11} />,
  agent_pre_write: <Bot size={11} />,
  agent_batch: <Bot size={11} />,
  before_command: <ShieldCheck size={11} />,
  checkpoint: <History size={11} />,
  rollback: <CornerUpLeft size={11} />
};

export function SnapshotsTab({ projectId }: SnapshotsTabProps) {
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [baseId, setBaseId] = useState<string | null>(null);
  const [baseAutoFollowsParent, setBaseAutoFollowsParent] = useState(true);
  const [diff, setDiff] = useState<SnapshotDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [filePair, setFilePair] = useState<FilePair | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [snapshotsPanelOpen, setSnapshotsPanelOpen] = useState(true);
  const [filesPanelOpen, setFilesPanelOpen] = useState(true);
  const diffEditorRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null);

  const loadSnapshots = useCallback(
    async (preferId?: string | null) => {
      try {
        const response = await projectsService.listSnapshots(projectId);
        setSnapshots(response.snapshots);
        setTargetId((current) => {
          if (preferId && response.snapshots.some((snap) => snap.id === preferId)) {
            return preferId;
          }
          if (current && response.snapshots.some((snap) => snap.id === current)) {
            return current;
          }
          return response.snapshots[0]?.id ?? null;
        });
      } catch (requestError) {
        setError(errorMessage(requestError, "فشل تحميل اللقطات."));
      }
    },
    [projectId]
  );

  useEffect(() => {
    setSnapshots(null);
    setTargetId(null);
    setBaseId(null);
    setBaseAutoFollowsParent(true);
    setDiff(null);
    setSelectedPath(null);
    setFilePair(null);
    setError(null);
    void loadSnapshots();
  }, [projectId, loadSnapshots]);

  const target = useMemo(
    () => snapshots?.find((snap) => snap.id === targetId) ?? null,
    [snapshots, targetId]
  );

  // When the target changes and we're in "auto" mode, sync base to its parent.
  useEffect(() => {
    if (!target) {
      setBaseId(null);
      return;
    }
    if (baseAutoFollowsParent) {
      setBaseId(target.parentSnapshotId);
    }
  }, [target, baseAutoFollowsParent]);

  // Load diff whenever the (target, base) pair changes.
  useEffect(() => {
    if (!targetId) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    setError(null);
    projectsService
      .diffSnapshots(targetId, baseId)
      .then((response) => {
        if (cancelled) return;
        setDiff(response.diff);
        // Pick the first changed file by default; otherwise the first entry.
        const firstChanged = response.diff.entries.find(
          (entry) => entry.status !== "unchanged"
        );
        setSelectedPath(firstChanged?.path ?? response.diff.entries[0]?.path ?? null);
      })
      .catch((requestError) => {
        if (cancelled) return;
        setError(errorMessage(requestError, "فشل تحميل الفروقات."));
        setDiff(null);
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [targetId, baseId]);

  // Load file contents whenever the selected diff entry changes.
  useEffect(() => {
    if (!selectedPath || !targetId) {
      setFilePair(null);
      return;
    }
    const entry = diff?.entries.find((item) => item.path === selectedPath);
    if (!entry) {
      setFilePair(null);
      return;
    }
    let cancelled = false;
    setFileLoading(true);
    setError(null);

    const wantBefore = baseId && entry.status !== "added";
    const wantAfter = entry.status !== "removed";

    const beforePromise = wantBefore
      ? projectsService.readSnapshotFile(baseId!, selectedPath).catch(() => null)
      : Promise.resolve(null);
    const afterPromise = wantAfter
      ? projectsService.readSnapshotFile(targetId, selectedPath).catch(() => null)
      : Promise.resolve(null);

    Promise.all([beforePromise, afterPromise])
      .then(([before, after]) => {
        if (cancelled) return;
        const binary = Boolean(before?.binary) || Boolean(after?.binary);
        setFilePair({
          before: before?.content ?? "",
          after: after?.content ?? "",
          binary
        });
      })
      .catch((requestError) => {
        if (cancelled) return;
        setError(errorMessage(requestError, "فشل تحميل محتوى الملف."));
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPath, diff, baseId, targetId]);

  const selectedEntry = useMemo(
    () => diff?.entries.find((entry) => entry.path === selectedPath) ?? null,
    [diff, selectedPath]
  );

  // Derive prev/next neighbours in the snapshot DAG. "Back" walks to the parent
  // (older); "Forward" jumps to the most recent snapshot that lists this one as
  // its parent.
  const { prevId, nextId } = useMemo(() => {
    if (!target || !snapshots) return { prevId: null, nextId: null };
    const children = snapshots.filter((snap) => snap.parentSnapshotId === target.id);
    // snapshots are ordered newest-first; pick the most recent direct child.
    const child = children[0];
    return {
      prevId: target.parentSnapshotId,
      nextId: child?.id ?? null
    };
  }, [target, snapshots]);

  function selectTarget(id: string | null) {
    setTargetId(id);
    setBaseAutoFollowsParent(true);
    setSelectedPath(null);
    setFilePair(null);
  }

  function selectBase(id: string | null) {
    setBaseId(id);
    setBaseAutoFollowsParent(false);
    setSelectedPath(null);
    setFilePair(null);
  }

  async function handleCreateSnapshot() {
    const message = window.prompt("رسالة اللقطة؟", "لقطة يدوية");
    if (!message) return;
    setBusy(true);
    setError(null);
    try {
      const response = await projectsService.createSnapshot(projectId, message);
      flashMessage(`Created snapshot ${response.snapshot.id.slice(0, 8)}`);
      await loadSnapshots(response.snapshot.id);
    } catch (requestError) {
      setError(errorMessage(requestError, "Failed to create snapshot."));
    } finally {
      setBusy(false);
    }
  }

  async function handleRestoreSnapshot() {
    if (!target) return;
    const ok = window.confirm(
      `Restore project files to snapshot ${target.id.slice(0, 8)}? A checkpoint of the current state will be saved first.`
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const result = await projectsService.restoreSnapshot(target.id, true);
      flashMessage(
        `Restored — ${result.written} files written, ${result.removed} removed.`
      );
      await loadSnapshots(target.id);
    } catch (requestError) {
      setError(errorMessage(requestError, "Failed to restore snapshot."));
    } finally {
      setBusy(false);
    }
  }

  async function handleRestoreFile() {
    if (!target || !selectedEntry) return;
    if (selectedEntry.status === "added") {
      const ok = window.confirm(
        `${selectedEntry.path} does not exist in the base snapshot. Write it to the project tree?`
      );
      if (!ok) return;
    } else if (selectedEntry.status === "removed") {
      setError(
        "This file was removed in the target snapshot — restore the target snapshot instead."
      );
      return;
    } else {
      const ok = window.confirm(
        `Restore ${selectedEntry.path} from snapshot ${target.id.slice(0, 8)}?`
      );
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await projectsService.restoreSnapshotFile(
        target.id,
        selectedEntry.path
      );
      flashMessage(
        result.restored
          ? `${selectedEntry.path} restored.`
          : `${selectedEntry.path} could not be restored.`
      );
    } catch (requestError) {
      setError(errorMessage(requestError, "Failed to restore file."));
    } finally {
      setBusy(false);
    }
  }

  function flashMessage(message: string) {
    setFlash(message);
    window.setTimeout(() => setFlash(null), 2400);
  }

  const handleDiffMount: DiffOnMount = (editor, monaco) => {
    diffEditorRef.current = editor;
    monaco.editor.defineTheme("singulary-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#0f0f11",
        "editor.foreground": "#fafafa",
        "editorLineNumber.foreground": "#56565f",
        "editorLineNumber.activeForeground": "#c8c8d0",
        "editor.lineHighlightBackground": "#16161a",
        "editorGutter.background": "#0f0f11",
        "editorWidget.background": "#16161a",
        "editorWidget.border": "#26262d",
        "diffEditor.insertedTextBackground": "#22c55e22",
        "diffEditor.removedTextBackground": "#f43f5e22",
        "diffEditor.insertedLineBackground": "#22c55e15",
        "diffEditor.removedLineBackground": "#f43f5e15"
      }
    });
    monaco.editor.setTheme("singulary-dark");
  };

  const changedEntries = diff?.entries.filter((entry) => entry.status !== "unchanged") ?? [];
  const visibleEntries = showUnchanged ? diff?.entries ?? [] : changedEntries;
  const summary = useMemo(() => summarizeDiff(diff), [diff]);

  const targetTitle = target ? snapshotDisplayTitle(target) : "";
  const targetSubtitle = target ? snapshotSubtitle(target) : "";

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-surface">
      {/* Snapshot list */}
      {snapshotsPanelOpen ? (
        <aside className="flex w-56 shrink-0 flex-col border-r border-hairline bg-bg/50 md:w-64 xl:w-72">
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-hairline px-3">
            <div className="text-[11px] tracking-tighter2 text-dim">اللقطات</div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleCreateSnapshot}
                disabled={busy}
                title="إنشاء لقطة"
                className="focus-ring grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-ink disabled:opacity-50"
              >
                <Plus size={13} />
              </button>
              <button
                type="button"
                onClick={() => setSnapshotsPanelOpen(false)}
                title="Hide snapshots panel"
                className="focus-ring grid h-6 w-6 place-items-center rounded-md text-dim transition-colors hover:bg-elevated hover:text-ink"
              >
                <PanelLeftClose size={13} />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!snapshots ? (
              <div className="grid h-full place-items-center py-10 text-muted">
                <Loader2 size={18} className="animate-spin" />
              </div>
            ) : snapshots.length === 0 ? (
              <EmptyHint
                icon={<Camera size={18} className="text-dim" />}
                title="لا توجد لقطات بعد"
                hint="Snapshots are taken before every AI write, or you can create one manually."
              />
            ) : (
              <ul className="divide-y divide-hairline">
                {snapshots.map((snapshot) => (
                  <SnapshotRow
                    key={snapshot.id}
                    snapshot={snapshot}
                    active={snapshot.id === targetId}
                    baseHint={snapshot.id === baseId ? "base" : null}
                    onSelect={() => selectTarget(snapshot.id)}
                    onSelectAsBase={() => selectBase(snapshot.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </aside>
      ) : null}

      {/* Diff panel */}
      <section className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-hairline bg-bg/50 px-2 py-1 text-xs text-muted">
          {!snapshotsPanelOpen ? (
            <button
              type="button"
              onClick={() => setSnapshotsPanelOpen(true)}
              title="Show snapshots panel"
              className="focus-ring grid h-7 w-7 place-items-center rounded-md text-dim transition-colors hover:bg-elevated hover:text-ink"
            >
              <PanelLeftOpen size={13} />
            </button>
          ) : null}
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => prevId && selectTarget(prevId)}
              disabled={!prevId}
              title="لقطة أقدم (الأصل)"
              className="focus-ring grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-ink disabled:opacity-40"
            >
              <ArrowLeft size={13} />
            </button>
            <button
              type="button"
              onClick={() => nextId && selectTarget(nextId)}
              disabled={!nextId}
              title="لقطة أحدث (الفرع)"
              className="focus-ring grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-ink disabled:opacity-40"
            >
              <ArrowRight size={13} />
            </button>
          </div>

          {target ? (
            <>
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <KindBadge kind={target.kind} compact />
                <span className="min-w-0 truncate text-ink" title={targetTitle}>
                  {targetTitle}
                </span>
                <span className="hidden text-dim md:inline">·</span>
                <span className="hidden truncate text-[11px] text-dim md:inline">
                  {targetSubtitle}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <label className="hidden items-center gap-2 text-[11px] text-dim md:flex">
                  <span className="hidden lg:inline">مقارنة مع</span>
                  <span className="lg:hidden">Base</span>
                  <select
                    value={baseId ?? ""}
                    onChange={(event) => selectBase(event.target.value || null)}
                    className="focus-ring h-7 max-w-[14rem] rounded-md border border-line bg-elevated px-2 text-xs text-ink"
                  >
                    <option value="">فارغ (الحالة الأولية)</option>
                    {snapshots
                      ?.filter((snap) => snap.id !== target.id)
                      .map((snap) => (
                        <option key={snap.id} value={snap.id}>
                          {`${snap.id.slice(0, 6)} · ${snapshotDisplayTitle(snap).slice(0, 40)}`}
                        </option>
                      ))}
                  </select>
                </label>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RotateCcw size={12} />}
                  onClick={handleRestoreSnapshot}
                  disabled={busy}
                >
                  <span className="hidden sm:inline">استعادة اللقطة</span>
                  <span className="sm:hidden">استعادة</span>
                </Button>
              </div>
            </>
          ) : (
            <div className="ml-auto text-dim">Select a snapshot</div>
          )}
        </div>

        {/* Flash + error */}
        {flash ? (
          <div className="flex items-center gap-2 border-b border-hairline bg-accentSoft px-3 py-2 text-xs text-accent">
            <Sparkles size={12} /> {flash}
          </div>
        ) : null}
        {error ? (
          <div className="flex items-center gap-2 border-b border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
            <AlertTriangle size={12} /> {error}
          </div>
        ) : null}

        {!target ? (
          <div className="grid flex-1 place-items-center px-6 text-center text-sm text-muted">
            <div>
              <div className="text-base font-medium text-ink">No snapshot selected</div>
              <div className="mt-1 text-xs text-dim">
                Pick a snapshot on the left to inspect its changes.
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            {/* File list */}
            {filesPanelOpen ? (
              <div className="flex w-56 shrink-0 flex-col border-r border-hairline bg-bg/30 md:w-64 xl:w-72">
                <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-hairline px-3 text-[11px] uppercase tracking-tighter2 text-dim">
                  <span>الملفات</span>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-[10px] normal-case tracking-normal text-dim">
                      <input
                        type="checkbox"
                        checked={showUnchanged}
                        onChange={(event) => setShowUnchanged(event.target.checked)}
                      />
                      <span className="hidden md:inline">إظهار بدون تغيير</span>
                      <span className="md:hidden">All</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setFilesPanelOpen(false)}
                      title="Hide files panel"
                      className="focus-ring grid h-6 w-6 place-items-center rounded-md text-dim transition-colors hover:bg-elevated hover:text-ink"
                    >
                      <PanelLeftClose size={13} />
                    </button>
                  </div>
                </div>
                <div className="border-b border-hairline px-3 py-2 text-[11px] text-dim">
                  <DiffSummaryStrip summary={summary} />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {diffLoading ? (
                    <div className="grid h-full place-items-center py-10 text-muted">
                      <Loader2 size={18} className="animate-spin" />
                    </div>
                  ) : visibleEntries.length === 0 ? (
                    <EmptyHint
                      icon={<FileDiff size={18} className="text-dim" />}
                      title="لا تغييرات"
                      hint={
                        diff && diff.entries.length > 0
                          ? "No differences between these snapshots. Toggle 'show unchanged' to browse all files."
                          : "هذه اللقطة فارغة."
                      }
                    />
                  ) : (
                    <ul className="divide-y divide-hairline">
                      {visibleEntries.map((entry) => (
                        <FileRow
                          key={entry.path}
                          entry={entry}
                          active={entry.path === selectedPath}
                          onSelect={() => setSelectedPath(entry.path)}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}

            {/* Diff viewer */}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-hairline bg-bg/50 px-2 py-1 text-xs">
                {!filesPanelOpen ? (
                  <button
                    type="button"
                    onClick={() => setFilesPanelOpen(true)}
                    title="Show files panel"
                    className="focus-ring grid h-7 w-7 place-items-center rounded-md text-dim transition-colors hover:bg-elevated hover:text-ink"
                  >
                    <PanelLeftOpen size={13} />
                  </button>
                ) : null}
                {selectedEntry ? (
                  <>
                    <StatusBadge status={selectedEntry.status} />
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink"
                      title={selectedEntry.path}
                    >
                      {selectedEntry.path}
                    </span>
                    <span className="hidden text-dim sm:inline">
                      {formatSizeDelta(selectedEntry)}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<RotateCcw size={12} />}
                      onClick={handleRestoreFile}
                      disabled={busy || selectedEntry.status === "removed"}
                      title={
                        selectedEntry.status === "removed"
                          ? "تم حذف الملف في هذه اللقطة — استعد اللقطة كاملة لإزالته من شجرة العمل."
                          : "Write this file from the target snapshot into the working tree."
                      }
                    >
                      <span className="hidden sm:inline">استعادة الملف</span>
                      <span className="sm:hidden">File</span>
                    </Button>
                  </>
                ) : (
                  <span className="text-dim">Select a file to view the diff</span>
                )}
              </div>
              <div className="relative min-h-0 flex-1">
                {selectedEntry && filePair?.binary ? (
                  <div className="grid h-full place-items-center text-center text-sm text-muted">
                    <div>
                      <div className="text-base font-medium text-ink">Binary file</div>
                      <div className="mt-1 text-xs text-dim">
                        Diff view is not available for binary files.
                      </div>
                    </div>
                  </div>
                ) : selectedEntry && filePair && !fileLoading ? (
                  <DiffEditor
                    height="100%"
                    theme="singulary-dark"
                    language={detectLanguage(selectedEntry.path)}
                    original={filePair.before}
                    modified={filePair.after}
                    onMount={handleDiffMount}
                    options={{
                      readOnly: true,
                      renderSideBySide: true,
                      fontSize: 13,
                      fontFamily: "JetBrains Mono, ui-monospace, monospace",
                      fontLigatures: true,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      renderOverviewRuler: false,
                      diffWordWrap: "on"
                    }}
                  />
                ) : selectedEntry && fileLoading ? (
                  <div className="grid h-full place-items-center text-muted">
                    <Loader2 size={20} className="animate-spin" />
                  </div>
                ) : (
                  <div className="grid h-full place-items-center text-sm text-muted">
                    <span>Select a file on the left to view its diff.</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function SnapshotRow({
  snapshot,
  active,
  baseHint,
  onSelect,
  onSelectAsBase
}: {
  snapshot: Snapshot;
  active: boolean;
  baseHint: string | null;
  onSelect: () => void;
  onSelectAsBase: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        onContextMenu={(event) => {
          event.preventDefault();
          onSelectAsBase();
        }}
        title="Click to inspect · right-click to use as base"
        className={`focus-ring flex w-full flex-col items-stretch gap-1 px-3 py-2 text-left transition-colors ${
          active ? "bg-elevated" : "hover:bg-elevated/60"
        }`}
      >
        <div className="flex items-center gap-1.5">
          <KindBadge kind={snapshot.kind} />
          {baseHint ? (
            <span className="rounded-sm border border-hairline bg-bg px-1 text-[9px] uppercase tracking-tighter2 text-dim">
              base
            </span>
          ) : null}
          <span className="ml-auto font-mono text-[10px] text-dim">
            {snapshot.id.slice(0, 8)}
          </span>
        </div>
        <div
          className={`truncate text-xs ${active ? "text-ink" : "text-muted"}`}
          title={snapshotDisplayTitle(snapshot)}
        >
          {snapshotDisplayTitle(snapshot)}
        </div>
        {snapshot.title && snapshot.message && snapshot.message !== snapshot.title ? (
          <div className="truncate text-[10px] text-dim" title={snapshot.message}>
            {snapshot.message}
          </div>
        ) : null}
        <div className="flex items-center justify-between text-[10px] text-dim">
          <span>{formatRelative(snapshot.createdAt)}</span>
          <span>
            {snapshot.fileCount} files · {formatBytes(snapshot.totalBytes)}
          </span>
        </div>
      </button>
    </li>
  );
}

function FileRow({
  entry,
  active,
  onSelect
}: {
  entry: SnapshotDiffEntry;
  active: boolean;
  onSelect: () => void;
}) {
  const name = entry.path.split("/").pop() ?? entry.path;
  const parent = entry.path.slice(0, entry.path.length - name.length);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`focus-ring flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
          active ? "bg-elevated" : "hover:bg-elevated/60"
        }`}
      >
        <StatusDot status={entry.status} />
        <div className="min-w-0 flex-1">
          <div className={`truncate text-xs ${active ? "text-ink" : "text-muted"}`}>{name}</div>
          {parent ? (
            <div className="truncate font-mono text-[10px] text-dim">{parent}</div>
          ) : null}
        </div>
      </button>
    </li>
  );
}

function StatusBadge({ status }: { status: SnapshotDiffEntry["status"] }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-tighter2 ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function StatusDot({ status }: { status: SnapshotDiffEntry["status"] }) {
  const color =
    status === "added"
      ? "bg-emerald-400"
      : status === "removed"
        ? "bg-danger"
        : status === "modified"
          ? "bg-accent"
          : "bg-dim";
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />;
}

function KindBadge({ kind, compact = false }: { kind: SnapshotKind; compact?: boolean }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline bg-bg px-1.5 py-0.5 text-[9px] uppercase tracking-tighter2 text-dim"
      title={KIND_LABEL[kind]}
    >
      {KIND_ICON[kind]}
      {compact ? null : KIND_LABEL[kind]}
    </span>
  );
}

function DiffSummaryStrip({
  summary
}: {
  summary: { added: number; removed: number; modified: number; unchanged: number };
}) {
  return (
    <div className="flex items-center gap-3 text-[11px]">
      <SummaryPill color="text-emerald-300" label="added" value={summary.added} />
      <SummaryPill color="text-accent" label="modified" value={summary.modified} />
      <SummaryPill color="text-danger" label="removed" value={summary.removed} />
      <span className="ml-auto text-dim">{summary.unchanged} unchanged</span>
    </div>
  );
}

function SummaryPill({
  color,
  label,
  value
}: {
  color: string;
  label: ChangedStatus | string;
  value: number;
}) {
  return (
    <span className={`inline-flex items-center gap-1 ${color}`}>
      <span className="font-semibold">{value}</span>
      <span className="text-dim">{label}</span>
    </span>
  );
}

function EmptyHint({
  icon,
  title,
  hint
}: {
  icon: JSX.Element;
  title: string;
  hint: string;
}) {
  return (
    <div className="grid place-items-center px-4 py-12 text-center">
      {icon}
      <div className="mt-3 text-sm text-ink">{title}</div>
      <div className="mt-1 max-w-xs text-xs text-muted">{hint}</div>
    </div>
  );
}

function snapshotDisplayTitle(snapshot: Snapshot): string {
  const title = snapshot.title?.trim();
  if (title) return title;
  const message = snapshot.message?.trim();
  if (message && !looksAutoGenerated(message)) return message;
  return `Snapshot ${snapshot.id.slice(0, 8)}`;
}

function snapshotSubtitle(snapshot: Snapshot): string {
  return `${snapshot.id.slice(0, 8)} · ${formatRelative(snapshot.createdAt)}`;
}

function looksAutoGenerated(message: string): boolean {
  // Suppress the verbose auto-snapshot fallback messages from the title slot.
  return (
    message.startsWith("Auto-snapshot before agent edits") ||
    message.startsWith("Checkpoint before restoring")
  );
}

function summarizeDiff(diff: SnapshotDiff | null) {
  const counts = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  if (!diff) return counts;
  for (const entry of diff.entries) counts[entry.status] += 1;
  return counts;
}

function formatSizeDelta(entry: SnapshotDiffEntry): string {
  if (entry.status === "added") return `+${formatBytes(entry.afterSize ?? 0)}`;
  if (entry.status === "removed") return `-${formatBytes(entry.beforeSize ?? 0)}`;
  if (entry.beforeSize == null || entry.afterSize == null) return "";
  const delta = entry.afterSize - entry.beforeSize;
  if (delta === 0) return formatBytes(entry.afterSize);
  return `${delta > 0 ? "+" : "-"}${formatBytes(Math.abs(delta))}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diffMs = Date.now() - date.getTime();
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) return `${Math.max(seconds, 1)}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

function detectLanguage(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    md: "markdown",
    mdx: "markdown",
    html: "html",
    css: "css",
    scss: "scss",
    less: "less",
    yaml: "yaml",
    yml: "yaml",
    toml: "ini",
    py: "python",
    go: "go",
    rs: "rust",
    rb: "ruby",
    php: "php",
    java: "java",
    sh: "shell",
    bash: "shell",
    sql: "sql",
    dockerfile: "dockerfile"
  };
  return map[ext ?? ""] ?? "plaintext";
}
