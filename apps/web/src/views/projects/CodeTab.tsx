import Editor, { type OnMount } from "@monaco-editor/react";
import {
  Check,
  Clipboard,
  Copy,
  FilePlus,
  FolderPlus,
  Loader2,
  Pencil,
  Scissors,
  Trash2,
  X
} from "lucide-react";
import type * as Monaco from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ContextMenu, type MenuItem } from "@/components/projects/ContextMenu";
import { FileTree, type TreeContext } from "@/components/projects/FileTree";
import { InlinePrompt } from "@/components/projects/InlinePrompt";
import { projectsService } from "@/services/projects.service";
import { errorMessage } from "@/utils/forms";

type OpenTab = {
  path: string;
  name: string;
  content: string;
  initialContent: string;
  loading: boolean;
  dirty: boolean;
};

type Clipboard = {
  path: string;
  mode: "cut" | "copy";
} | null;

type PromptState =
  | { mode: "rename"; path: string; initial: string }
  | { mode: "new-file"; parent: string }
  | { mode: "new-folder"; parent: string }
  | null;

type MenuState = {
  x: number;
  y: number;
  ctx: TreeContext;
} | null;

type CodeTabProps = {
  projectId: string;
};

export function CodeTab({ projectId }: CodeTabProps) {
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [menu, setMenu] = useState<MenuState>(null);
  const [prompt, setPrompt] = useState<PromptState>(null);
  const [clipboard, setClipboard] = useState<Clipboard>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);

  const active = tabs.find((tab) => tab.path === activePath) ?? null;

  const refreshTree = useCallback(() => setRefreshToken((value) => value + 1), []);

  function openFile(path: string) {
    setActivePath(path);
    setTabs((current) => {
      if (current.some((tab) => tab.path === path)) return current;
      const name = path.split("/").pop() ?? path;
      return [
        ...current,
        {
          path,
          name,
          content: "",
          initialContent: "",
          loading: true,
          dirty: false
        }
      ];
    });

    projectsService
      .readFile(projectId, path)
      .then((response) => {
        setTabs((current) =>
          current.map((tab) =>
            tab.path === path
              ? {
                  ...tab,
                  content: response.content,
                  initialContent: response.content,
                  loading: false,
                  dirty: false
                }
              : tab
          )
        );
      })
      .catch((requestError) => {
        setError(errorMessage(requestError, "Could not load file."));
        closeTab(path);
      });
  }

  function closeTab(path: string) {
    setTabs((current) => {
      const next = current.filter((tab) => tab.path !== path);
      if (path === activePath) {
        const fallback = next[next.length - 1]?.path ?? null;
        setActivePath(fallback);
      }
      return next;
    });
  }

  function handleEditorChange(value: string | undefined) {
    if (!activePath) return;
    setTabs((current) =>
      current.map((tab) =>
        tab.path === activePath
          ? { ...tab, content: value ?? "", dirty: (value ?? "") !== tab.initialContent }
          : tab
      )
    );
  }

  const saveActive = useCallback(async () => {
    const tab = active;
    if (!tab || !tab.dirty) return;
    setError(null);
    try {
      await projectsService.writeFile(projectId, tab.path, tab.content);
      setTabs((current) =>
        current.map((entry) =>
          entry.path === tab.path
            ? { ...entry, initialContent: entry.content, dirty: false }
            : entry
        )
      );
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1200);
    } catch (requestError) {
      setError(errorMessage(requestError, "Failed to save."));
    }
  }, [active, projectId]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveActive();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [saveActive]);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
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
        "editorIndentGuide.background": "#1f1f25",
        "editorIndentGuide.activeBackground": "#26262d",
        "editorCursor.foreground": "#ec4899",
        "editor.selectionBackground": "#ec489966",
        "editor.findMatchBackground": "#ec489955",
        "editorGutter.background": "#0f0f11",
        "editorWidget.background": "#16161a",
        "editorWidget.border": "#26262d",
        "scrollbarSlider.background": "#26262d80",
        "scrollbarSlider.hoverBackground": "#33333caa",
        "scrollbarSlider.activeBackground": "#33333c"
      }
    });
    monaco.editor.setTheme("singulary-dark");
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void saveActive();
    });
  };

  async function handleRename(path: string, newName: string) {
    const segments = path.split("/");
    segments[segments.length - 1] = newName;
    const target = segments.join("/");
    await projectsService.renameEntry(projectId, path, target);
    setTabs((current) =>
      current.map((tab) =>
        tab.path === path ? { ...tab, path: target, name: newName } : tab
      )
    );
    if (activePath === path) setActivePath(target);
    refreshTree();
  }

  async function handleCreate(parent: string, name: string, type: "file" | "directory") {
    const target = parent ? `${parent}/${name}` : name;
    await projectsService.createEntry(projectId, target, type);
    refreshTree();
    if (type === "file") openFile(target);
  }

  async function handleDelete(path: string) {
    if (!window.confirm(`Delete ${path}?`)) return;
    await projectsService.deleteEntry(projectId, path);
    setTabs((current) => current.filter((tab) => tab.path !== path && !tab.path.startsWith(`${path}/`)));
    if (activePath === path) setActivePath(null);
    refreshTree();
  }

  async function handlePaste(target: TreeContext) {
    if (!clipboard) return;
    const sourceName = clipboard.path.split("/").pop() ?? clipboard.path;
    const parent = target.type === "directory" ? target.path : target.parent;
    const destination = parent ? `${parent}/${sourceName}` : sourceName;
    try {
      if (clipboard.mode === "cut") {
        await projectsService.renameEntry(projectId, clipboard.path, destination);
        setClipboard(null);
      } else {
        await projectsService.copyEntry(projectId, clipboard.path, destination);
      }
      refreshTree();
    } catch (requestError) {
      setError(errorMessage(requestError, "Paste failed."));
    }
  }

  const menuItems: MenuItem[] = useMemo(() => {
    if (!menu) return [];
    const ctx = menu.ctx;
    if (ctx.type === "background") {
      return [
        {
          kind: "item",
          icon: <FilePlus size={13} />,
          label: "New file",
          onSelect: () => setPrompt({ mode: "new-file", parent: "" })
        },
        {
          kind: "item",
          icon: <FolderPlus size={13} />,
          label: "New folder",
          onSelect: () => setPrompt({ mode: "new-folder", parent: "" })
        },
        ...(clipboard
          ? ([
              { kind: "separator" },
              {
                kind: "item",
                icon: <Clipboard size={13} />,
                label: "Paste",
                onSelect: () => void handlePaste(ctx)
              }
            ] as MenuItem[])
          : [])
      ];
    }

    const base: MenuItem[] = [
      {
        kind: "item",
        icon: <Pencil size={13} />,
        label: "Rename",
        onSelect: () =>
          setPrompt({ mode: "rename", path: ctx.path, initial: ctx.path.split("/").pop() ?? "" })
      },
      {
        kind: "item",
        icon: <Scissors size={13} />,
        label: "Cut",
        onSelect: () => setClipboard({ path: ctx.path, mode: "cut" })
      },
      {
        kind: "item",
        icon: <Copy size={13} />,
        label: "Copy",
        onSelect: () => setClipboard({ path: ctx.path, mode: "copy" })
      }
    ];

    if (clipboard) {
      base.push({
        kind: "item",
        icon: <Clipboard size={13} />,
        label: "Paste",
        onSelect: () => void handlePaste(ctx)
      });
    }

    if (ctx.type === "directory") {
      base.push(
        { kind: "separator" },
        {
          kind: "item",
          icon: <FilePlus size={13} />,
          label: "New file",
          onSelect: () => setPrompt({ mode: "new-file", parent: ctx.path })
        },
        {
          kind: "item",
          icon: <FolderPlus size={13} />,
          label: "New folder",
          onSelect: () => setPrompt({ mode: "new-folder", parent: ctx.path })
        }
      );
    }

    base.push(
      { kind: "separator" },
      {
        kind: "item",
        icon: <Trash2 size={13} />,
        label: "Delete",
        danger: true,
        onSelect: () => void handleDelete(ctx.path)
      }
    );

    return base;
  }, [menu, clipboard]);

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-surface">
      <div className="w-64 shrink-0 border-r border-hairline bg-bg/50">
        <FileTree
          projectId={projectId}
          activePath={activePath}
          refreshToken={refreshToken}
          onOpenFile={openFile}
          onContextMenu={(event, ctx) => setMenu({ x: event.clientX, y: event.clientY, ctx })}
          onCreate={(parent, type) =>
            setPrompt(type === "file" ? { mode: "new-file", parent } : { mode: "new-folder", parent })
          }
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-hairline bg-bg/50 px-2">
          {tabs.length === 0 ? (
            <div className="px-2 text-[11px] uppercase tracking-tighter2 text-dim">No files open</div>
          ) : (
            tabs.map((tab) => {
              const isActive = tab.path === activePath;
              return (
                <div
                  key={tab.path}
                  className={`group flex h-8 items-center gap-1.5 rounded-md px-2 text-xs transition-colors ${
                    isActive ? "bg-elevated text-ink" : "text-muted hover:bg-elevated hover:text-ink"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActivePath(tab.path)}
                    className="focus-ring flex items-center gap-1.5"
                  >
                    <span className="truncate">{tab.name}</span>
                    {tab.dirty ? <span className="h-1.5 w-1.5 rounded-full bg-accent" /> : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => closeTab(tab.path)}
                    className="focus-ring grid h-5 w-5 place-items-center rounded-sm text-dim transition-colors hover:bg-raised hover:text-ink"
                  >
                    <X size={11} />
                  </button>
                </div>
              );
            })
          )}
          <div className="ml-auto flex items-center gap-2 px-2 text-[11px] text-dim">
            {savedFlash ? (
              <span className="inline-flex items-center gap-1 text-accent">
                <Check size={11} /> Saved
              </span>
            ) : active?.dirty ? (
              <span>Cmd/Ctrl+S to save</span>
            ) : null}
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          {error ? (
            <div className="absolute inset-x-3 top-3 z-10 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          ) : null}
          {active ? (
            active.loading ? (
              <div className="grid h-full place-items-center text-muted">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : (
              <Editor
                height="100%"
                theme="singulary-dark"
                language={detectLanguage(active.name)}
                value={active.content}
                onMount={handleEditorMount}
                onChange={handleEditorChange}
                options={{
                  fontSize: 13,
                  fontFamily: "JetBrains Mono, ui-monospace, monospace",
                  fontLigatures: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  smoothScrolling: true,
                  cursorBlinking: "smooth",
                  cursorSmoothCaretAnimation: "on",
                  renderLineHighlight: "all",
                  padding: { top: 14, bottom: 14 },
                  tabSize: 2
                }}
              />
            )
          ) : (
            <div className="grid h-full place-items-center px-6 text-center text-sm text-muted">
              <div>
                <div className="text-base font-medium text-ink">No file open</div>
                <div className="mt-1 text-xs text-dim">Select a file from the sidebar to start editing.</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      ) : null}

      {prompt?.mode === "rename" ? (
        <InlinePrompt
          title="Rename"
          initial={prompt.initial}
          submitLabel="Rename"
          onSubmit={async (name) => {
            await handleRename(prompt.path, name);
            setPrompt(null);
          }}
          onCancel={() => setPrompt(null)}
        />
      ) : null}

      {prompt?.mode === "new-file" ? (
        <InlinePrompt
          title="New file"
          label="Name"
          placeholder="example.ts"
          submitLabel="Create"
          onSubmit={async (name) => {
            await handleCreate(prompt.parent, name, "file");
            setPrompt(null);
          }}
          onCancel={() => setPrompt(null)}
        />
      ) : null}

      {prompt?.mode === "new-folder" ? (
        <InlinePrompt
          title="New folder"
          label="Name"
          placeholder="components"
          submitLabel="Create"
          onSubmit={async (name) => {
            await handleCreate(prompt.parent, name, "directory");
            setPrompt(null);
          }}
          onCancel={() => setPrompt(null)}
        />
      ) : null}
    </div>
  );
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
