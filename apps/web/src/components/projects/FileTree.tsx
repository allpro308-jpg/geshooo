import type { FileEntry } from "@singulary/shared";
import {
  ChevronRight,
  File as FileIcon,
  FileCode,
  FileJson,
  FileText,
  FolderClosed,
  FolderOpen,
  Loader2,
  Plus
} from "lucide-react";
import { useEffect, useState } from "react";

import { projectsService } from "@/services/projects.service";

export type TreeContext = {
  type: "file" | "directory" | "background";
  path: string;
  parent: string;
};

type FileTreeProps = {
  projectId: string;
  activePath: string | null;
  refreshToken: number;
  onOpenFile: (path: string) => void;
  onContextMenu: (event: React.MouseEvent, ctx: TreeContext) => void;
  onCreate?: (parent: string, type: "file" | "directory") => void;
};

export function FileTree({
  projectId,
  activePath,
  refreshToken,
  onOpenFile,
  onContextMenu,
  onCreate
}: FileTreeProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-hairline px-3">
        <div className="text-[10px] font-semibold tracking-tighter2 text-dim">الملفات</div>
        {onCreate ? (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => onCreate("", "file")}
              className="focus-ring grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-ink"
              title="ملف جديد"
            >
              <Plus size={12} />
            </button>
          </div>
        ) : null}
      </div>
      <div
        className="flex-1 overflow-auto py-1"
        onContextMenu={(event) => {
          if (event.target === event.currentTarget) {
            onContextMenu(event, { type: "background", path: "", parent: "" });
          }
        }}
      >
        <TreeNode
          projectId={projectId}
          dirPath=""
          depth={0}
          activePath={activePath}
          refreshToken={refreshToken}
          onOpenFile={onOpenFile}
          onContextMenu={onContextMenu}
          forceOpen
        />
      </div>
    </div>
  );
}

function TreeNode({
  projectId,
  dirPath,
  depth,
  activePath,
  refreshToken,
  onOpenFile,
  onContextMenu,
  forceOpen = false
}: {
  projectId: string;
  dirPath: string;
  depth: number;
  activePath: string | null;
  refreshToken: number;
  onOpenFile: (path: string) => void;
  onContextMenu: (event: React.MouseEvent, ctx: TreeContext) => void;
  forceOpen?: boolean;
}) {
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(forceOpen);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    projectsService
      .listFiles(projectId, dirPath)
      .then((response) => {
        if (!cancelled) setEntries(response.entries);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, dirPath, open, refreshToken]);

  if (!open && !forceOpen) return null;

  return (
    <div>
      {loading && !entries ? (
        <div className="flex items-center gap-2 px-3 py-1 text-xs text-dim">
          <Loader2 size={12} className="animate-spin" />
          جارٍ التحميل…
        </div>
      ) : null}
      {entries?.map((entry) =>
        entry.type === "directory" ? (
          <DirectoryNode
            key={entry.path}
            projectId={projectId}
            entry={entry}
            depth={depth + 1}
            activePath={activePath}
            refreshToken={refreshToken}
            onOpenFile={onOpenFile}
            onContextMenu={onContextMenu}
          />
        ) : (
          <FileNode
            key={entry.path}
            entry={entry}
            depth={depth + 1}
            active={entry.path === activePath}
            onOpenFile={onOpenFile}
            onContextMenu={onContextMenu}
          />
        )
      )}
      {entries?.length === 0 && depth === 0 ? (
        <div className="px-3 py-2 text-xs text-dim">مجلد فارغ.</div>
      ) : null}
    </div>
  );
}

function DirectoryNode({
  projectId,
  entry,
  depth,
  activePath,
  refreshToken,
  onOpenFile,
  onContextMenu
}: {
  projectId: string;
  entry: FileEntry;
  depth: number;
  activePath: string | null;
  refreshToken: number;
  onOpenFile: (path: string) => void;
  onContextMenu: (event: React.MouseEvent, ctx: TreeContext) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenu(event, { type: "directory", path: entry.path, parent: entry.path });
        }}
        style={{ paddingLeft: 8 + depth * 12 }}
        className="group flex w-full items-center gap-1.5 py-1 pr-2 text-left text-sm text-muted transition-colors hover:bg-elevated hover:text-ink"
      >
        <ChevronRight
          size={12}
          className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        {open ? (
          <FolderOpen size={13} className="shrink-0 text-accent" />
        ) : (
          <FolderClosed size={13} className="shrink-0 text-muted" />
        )}
        <span className="truncate">{entry.name}</span>
      </button>
      {open ? (
        <TreeNode
          projectId={projectId}
          dirPath={entry.path}
          depth={depth}
          activePath={activePath}
          refreshToken={refreshToken}
          onOpenFile={onOpenFile}
          onContextMenu={onContextMenu}
          forceOpen
        />
      ) : null}
    </>
  );
}

function FileNode({
  entry,
  depth,
  active,
  onOpenFile,
  onContextMenu
}: {
  entry: FileEntry;
  depth: number;
  active: boolean;
  onOpenFile: (path: string) => void;
  onContextMenu: (event: React.MouseEvent, ctx: TreeContext) => void;
}) {
  const parent = entry.path.includes("/") ? entry.path.replace(/\/[^/]+$/, "") : "";
  return (
    <button
      type="button"
      onClick={() => onOpenFile(entry.path)}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(event, { type: "file", path: entry.path, parent });
      }}
      style={{ paddingLeft: 8 + depth * 12 + 12 }}
      className={`group flex w-full items-center gap-1.5 py-1 pr-2 text-left text-sm transition-colors ${
        active ? "bg-elevated text-ink" : "text-muted hover:bg-elevated hover:text-ink"
      }`}
    >
      <FileIconFor name={entry.name} />
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

function FileIconFor({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (["json", "lock"].includes(ext ?? "")) return <FileJson size={13} className="shrink-0 text-yellow-300/80" />;
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "go", "rs", "py", "rb", "php", "java", "c", "cpp", "h"].includes(ext ?? ""))
    return <FileCode size={13} className="shrink-0 text-pink-300" />;
  if (["md", "mdx", "txt", "yaml", "yml", "toml"].includes(ext ?? ""))
    return <FileText size={13} className="shrink-0 text-muted" />;
  return <FileIcon size={13} className="shrink-0 text-muted" />;
}
