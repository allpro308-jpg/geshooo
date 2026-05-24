import {
  ArrowLeft,
  Cable,
  ChevronsLeft,
  ChevronsRight,
  Code2,
  Database,
  FolderGit2,
  GitBranch,
  Monitor,
  Plus,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Sparkles
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link, NavLink, useMatch, useParams, useSearchParams } from "react-router-dom";

import { ChatPanel } from "@/components/chat/ChatPanel";
import { useProjectEvents } from "@/hooks/useProjectEvents";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { useAgentStore } from "@/stores/agent.store";
import { parseTab, type ProjectTabDef,projectTabs } from "@/views/projects/tabs";

import { Logo, LogoMark } from "./Logo";
import { ProjectStatusBar } from "./ProjectStatusBar";
import { ProjectTerminalPanel } from "./ProjectTerminalPanel";
import { UserMenu } from "./UserMenu";

type WorkspaceLayoutProps = {
  children: ReactNode;
  onCreateProject?: () => void;
  onCreateService?: () => void;
  fullBleed?: boolean;
};

export function WorkspaceLayout({
  children,
  onCreateProject,
  onCreateService,
  fullBleed
}: WorkspaceLayoutProps) {
  const params = useParams<{ id: string; projectId?: string; serviceId?: string }>();
  const projectMatch = useMatch("/workspaces/:id/projects/:projectId");
  const { workspaces, projects, services } = useWorkspaces();
  const { chatPanelOpen, toggleChatPanel } = useAgentStore();

  const workspace = workspaces.find((entry) => entry.id === params.id);
  const workspaceProjects = projects.filter((project) => project.workspaceId === params.id);
  const workspaceServices = services.filter((service) => service.workspaceId === params.id);
  const activeProject = projectMatch
    ? projects.find((entry) => entry.id === projectMatch.params.projectId)
    : null;

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("singulary:sidebar:collapsed") === "1";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("singulary:sidebar:collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  const isProjectRoute = Boolean(projectMatch);
  const stretch = fullBleed ?? isProjectRoute;

  // Open one events WebSocket per active project. Its presence keeps the
  // container alive; the server stops the container after 5 minutes with no
  // clients connected (across all users/tabs).
  useProjectEvents(activeProject?.id);

  return (
    <div className="flex h-screen flex-col bg-bg text-ink">
      <header className="sticky top-0 z-20 shrink-0 border-b border-hairline bg-bg/85 backdrop-blur-xl">
        <div className="grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 sm:gap-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Link to="/" className="focus-ring shrink-0 rounded-md outline-none">
              <Logo compact />
            </Link>
            <div className="hidden h-5 w-px shrink-0 bg-hairline sm:block" />
            <Link
              to="/"
              title="All workspaces"
              className="focus-ring flex shrink-0 items-center gap-2 rounded-md text-muted transition-colors hover:text-ink"
            >
              <ArrowLeft size={16} />
              <span className="hidden text-sm xl:inline">All workspaces</span>
            </Link>
            {workspace ? (
              <div className="hidden min-w-0 items-center gap-2 sm:flex">
                <span className="text-muted">/</span>
                <Link
                  to={`/workspaces/${workspace.id}`}
                  className={`focus-ring max-w-[180px] truncate rounded-md text-sm font-medium tracking-tightish transition-colors lg:max-w-[160px] xl:max-w-[220px] ${
                    activeProject ? "text-muted hover:text-ink" : "text-ink"
                  }`}
                  title={workspace.name}
                >
                  {workspace.name}
                </Link>
                {activeProject ? (
                  <>
                    <span className="hidden text-muted md:inline">/</span>
                    <span
                      className="hidden max-w-[160px] truncate text-sm font-medium tracking-tightish text-ink md:inline xl:max-w-[220px]"
                      title={activeProject.name}
                    >
                      {activeProject.name}
                    </span>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="hidden min-w-0 justify-center lg:flex">
            {isProjectRoute ? <ProjectTabsBar variant="inline" /> : null}
          </div>

          <div className="flex items-center justify-end">
            <UserMenu />
          </div>
        </div>

        {isProjectRoute ? (
          <div className="border-t border-hairline lg:hidden">
            <div className="overflow-x-auto px-3 sm:px-5">
              <ProjectTabsBar variant="strip" />
            </div>
          </div>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          className={`flex h-full shrink-0 flex-col border-r border-hairline bg-surface transition-[width] duration-200 ${
            collapsed ? "w-14" : "w-64"
          }`}
        >
          <div className="flex-1 overflow-y-auto py-3">
            <SidebarGroup
              label="Projects"
              collapsed={collapsed}
              action={
                onCreateProject ? (
                  <button
                    type="button"
                    onClick={onCreateProject}
                    className="focus-ring grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-ink"
                    aria-label="New project"
                    title="New project"
                  >
                    <Plus size={14} />
                  </button>
                ) : null
              }
            >
              {workspaceProjects.length === 0 && !collapsed ? (
                <div className="px-3 py-2 text-xs text-dim">No projects yet.</div>
              ) : null}
              {workspaceProjects.map((project) => (
                <SidebarLink
                  key={project.id}
                  to={`/workspaces/${params.id}/projects/${project.id}`}
                  collapsed={collapsed}
                  icon={<FolderGit2 size={15} />}
                  label={project.name}
                  hint={project.runtimeKind}
                />
              ))}
            </SidebarGroup>

            <div className="mx-3 my-3 h-px bg-hairline" />

            <SidebarGroup
              label="Services"
              collapsed={collapsed}
              action={
                onCreateService ? (
                  <button
                    type="button"
                    onClick={onCreateService}
                    className="focus-ring grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-ink"
                    aria-label="New service"
                    title="New service"
                  >
                    <Plus size={14} />
                  </button>
                ) : null
              }
            >
              {workspaceServices.length === 0 && !collapsed ? (
                <div className="px-3 py-2 text-xs text-dim">No services yet.</div>
              ) : null}
              {workspaceServices.map((service) => (
                <SidebarLink
                  key={service.id}
                  to={`/workspaces/${params.id}/services/${service.id}`}
                  collapsed={collapsed}
                  icon={<Database size={15} />}
                  label={service.name}
                  hint={service.kind.replace("database_", "")}
                />
              ))}
            </SidebarGroup>
          </div>

          {isProjectRoute ? (
            <button
              type="button"
              onClick={() => toggleChatPanel()}
              title={chatPanelOpen ? "Hide assistant" : "Show AI assistant"}
              className={`focus-ring flex h-10 items-center justify-center gap-2 border-t border-hairline text-xs font-medium transition-colors outline-none ${
                chatPanelOpen
                  ? "bg-accent/10 text-accent hover:bg-accent/20"
                  : "text-muted hover:bg-elevated hover:text-ink"
              }`}
            >
              <Sparkles size={15} className={chatPanelOpen ? "animate-pulse" : ""} />
              {!collapsed && <span>Toggle Chat</span>}
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="focus-ring flex h-10 items-center justify-center gap-2 border-t border-hairline text-xs text-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            {collapsed ? (
              <ChevronsRight size={15} />
            ) : (
              <>
                <ChevronsLeft size={15} />
                <span>Collapse</span>
              </>
            )}
          </button>
        </aside>

        {isProjectRoute && <ChatPanel />}

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {workspace ? (
              stretch ? (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
              ) : (
                <div className="mx-auto w-full max-w-6xl flex-1 overflow-y-auto px-6 py-8">
                  {children}
                </div>
              )
            ) : (
              <div className="grid flex-1 place-items-center px-6 py-32 text-center">
                <div className="mb-3 grid h-12 w-12 place-items-center rounded-xl border border-line bg-surface">
                  <LogoMark />
                </div>
                <h2 className="text-base font-medium text-ink">Workspace not found</h2>
                <p className="mt-1 text-sm text-muted">It may have been deleted or you do not have access.</p>
                <Link
                  to="/"
                  className="focus-ring mt-5 inline-flex h-9 items-center rounded-lg border border-line bg-elevated px-3 text-sm text-ink transition-colors hover:bg-raised"
                >
                  Back to dashboard
                </Link>
              </div>
            )}
          </div>

          {activeProject ? (
            <>
              <ProjectTerminalPanel project={activeProject} />
              <ProjectStatusBar project={activeProject} />
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}

function ProjectTabsBar({ variant }: { variant: "inline" | "strip" }) {
  const [params, setParams] = useSearchParams();
  const active = parseTab(params.get("tab"));

  return (
    <div
      className={
        variant === "inline"
          ? "flex items-center gap-0.5 rounded-lg border border-hairline bg-elevated/60 p-0.5"
          : "flex items-center gap-1"
      }
    >
      {projectTabs.map((tab) => (
        <ProjectTabButton
          key={tab.id}
          tab={tab}
          variant={variant}
          active={tab.id === active}
          onSelect={() => {
            const next = new URLSearchParams(params);
            if (tab.id === "code") {
              next.delete("tab");
            } else {
              next.set("tab", tab.id);
            }
            setParams(next, { replace: true });
          }}
        />
      ))}
    </div>
  );
}

const tabIcons = {
  code: <Code2 size={14} />,
  env: <SlidersHorizontal size={14} />,
  preview: <Monitor size={14} />,
  branches: <GitBranch size={14} />,
  connections: <Cable size={14} />,
  settings: <SettingsIcon size={14} />
};

function ProjectTabButton({
  tab,
  active,
  variant,
  onSelect
}: {
  tab: ProjectTabDef;
  active: boolean;
  variant: "inline" | "strip";
  onSelect: () => void;
}) {
  if (variant === "inline") {
    return (
      <button
        type="button"
        onClick={onSelect}
        disabled={tab.comingSoon && !active}
        title={tab.comingSoon ? `${tab.label} (coming soon)` : tab.label}
        className={`focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors xl:text-sm ${
          active
            ? "bg-bg text-ink shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset]"
            : "text-muted hover:bg-elevated hover:text-ink"
        } ${tab.comingSoon && !active ? "opacity-50" : ""}`}
      >
        <span className="shrink-0">{tabIcons[tab.iconKey]}</span>
        <span className="hidden xl:inline">{tab.label}</span>
        <span className="xl:hidden">{tab.label}</span>
        {tab.comingSoon ? (
          <span className="ml-0.5 hidden h-1 w-1 rounded-full bg-dim xl:inline-block" />
        ) : null}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={tab.comingSoon && !active}
      className={`focus-ring relative -mb-px inline-flex h-10 shrink-0 items-center gap-2 px-3 text-sm font-medium transition-colors ${
        active ? "text-ink" : "text-muted hover:text-ink"
      } ${tab.comingSoon ? "opacity-70" : ""}`}
    >
      {tabIcons[tab.iconKey]}
      <span>{tab.label}</span>
      {tab.comingSoon ? (
        <span className="rounded-full border border-line bg-elevated px-1.5 py-0.5 text-[9px] uppercase tracking-tighter2 text-dim">
          soon
        </span>
      ) : null}
      {active ? (
        <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-accent" />
      ) : null}
    </button>
  );
}

function SidebarGroup({
  label,
  collapsed,
  action,
  children
}: {
  label: string;
  collapsed: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="px-2">
      {!collapsed ? (
        <div className="mb-1 flex h-7 items-center justify-between px-2 text-[10px] font-semibold uppercase tracking-tighter2 text-dim">
          <span>{label}</span>
          {action}
        </div>
      ) : (
        <div className="mb-1 flex h-7 items-center justify-center text-[10px] font-semibold uppercase tracking-tighter2 text-dim">
          {label.slice(0, 1)}
        </div>
      )}
      <div className="grid gap-0.5">{children}</div>
    </div>
  );
}

function SidebarLink({
  to,
  icon,
  label,
  hint,
  collapsed
}: {
  to: string;
  icon: ReactNode;
  label: string;
  hint?: string;
  collapsed: boolean;
}) {
  return (
    <NavLink
      to={to}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        `group relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors ${
          isActive
            ? "bg-elevated text-ink"
            : "text-muted hover:bg-elevated hover:text-ink"
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span className={`shrink-0 ${isActive ? "text-accent" : "text-muted group-hover:text-ink"}`}>{icon}</span>
          {!collapsed ? (
            <>
              <span className="truncate font-medium">{label}</span>
              {hint ? <span className="ml-auto text-[10px] uppercase tracking-tighter2 text-dim">{hint}</span> : null}
            </>
          ) : null}
          {isActive ? (
            <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-accent" />
          ) : null}
        </>
      )}
    </NavLink>
  );
}

