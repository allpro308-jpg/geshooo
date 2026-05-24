import type {
  Project,
  ServiceStatus,
  ServiceTemplate,
  Workspace,
  WorkspaceService
} from "@singulary/shared";
import {
  ArrowUpRight,
  Boxes,
  Database,
  FolderGit2,
  Plus,
  Sparkles,
  X
} from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { WorkspaceLayout } from "@/components/layout/WorkspaceLayout";
import { ServiceWizard } from "@/components/services/ServiceWizard";
import { Button } from "@/components/ui/Button";
import { selectClass,TextInput } from "@/components/ui/FormField";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { workspacesService } from "@/services/workspaces.service";
import { errorMessage } from "@/utils/forms";

const runtimeKinds = ["node", "bun", "deno", "python", "go", "rust", "php", "static", "custom_dockerfile"];

export function WorkspaceDetailPage() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    workspaces,
    projects,
    services,
    error: workspacesError,
    setError,
    createProject,
    createService
  } = useWorkspaces();

  const workspace = workspaces.find((entry) => entry.id === params.id);
  const workspaceProjects = useMemo(
    () => projects.filter((project) => project.workspaceId === params.id),
    [projects, params.id]
  );
  const workspaceServices = useMemo(
    () => services.filter((service) => service.workspaceId === params.id),
    [services, params.id]
  );

  const [projectDialog, setProjectDialog] = useState(false);
  const [serviceDialog, setServiceDialog] = useState(false);
  const [templates, setTemplates] = useState<ServiceTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!serviceDialog || templates.length > 0) return;
    setTemplatesLoading(true);
    workspacesService
      .listServiceTemplates()
      .then((response) => setTemplates(response.templates))
      .catch((requestError) => setLocalError(errorMessage(requestError, "Failed to load service templates.")))
      .finally(() => setTemplatesLoading(false));
  }, [serviceDialog, templates.length]);

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;
    setError(null);
    setLocalError(null);
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      await createProject({
        workspaceId: workspace.id,
        name: String(formData.get("name") ?? ""),
        runtimeKind: String(formData.get("runtimeKind") ?? "node")
      });
      form.reset();
      setProjectDialog(false);
    } catch (requestError) {
      setLocalError(errorMessage(requestError, "Failed to create project."));
    }
  }

  const error = workspacesError ?? localError;

  return (
    <WorkspaceLayout
      onCreateProject={() => setProjectDialog(true)}
      onCreateService={() => setServiceDialog(true)}
    >
      {workspace ? (
        <>
          <WorkspaceHeader workspace={workspace} />

          {error ? (
            <div className="mb-6 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          ) : null}

          <div className="mt-2 grid gap-6 lg:grid-cols-2">
            <SectionPanel
              title="Projects"
              hint={`${workspaceProjects.length} active`}
              action={
                <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setProjectDialog(true)}>
                  New project
                </Button>
              }
            >
              {workspaceProjects.length === 0 ? (
                <EmptyState
                  icon={<FolderGit2 size={18} />}
                  title="No projects yet"
                  hint="Add a frontend, backend, worker, or any runnable unit."
                />
              ) : (
                <div className="grid gap-2">
                  {workspaceProjects.map((project) => (
                    <ProjectRow
                      key={project.id}
                      project={project}
                      onOpen={() => navigate(`/workspaces/${workspace.id}/projects/${project.id}`)}
                    />
                  ))}
                </div>
              )}
            </SectionPanel>

            <SectionPanel
              title="Services"
              hint={`${workspaceServices.length} attached`}
              action={
                <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setServiceDialog(true)}>
                  New service
                </Button>
              }
            >
              {workspaceServices.length === 0 ? (
                <EmptyState
                  icon={<Database size={18} />}
                  title="No services attached"
                  hint="Add Postgres, Redis, object storage, or any shared dependency."
                />
              ) : (
                <div className="grid gap-2">
                  {workspaceServices.map((service) => (
                    <ServiceRow
                      key={service.id}
                      service={service}
                      onOpen={() => navigate(`/workspaces/${workspace.id}/services/${service.id}`)}
                    />
                  ))}
                </div>
              )}
            </SectionPanel>
          </div>

          <div className="mt-8 rounded-xl border border-hairline bg-surface p-5">
            <div className="flex items-center gap-2 text-accent">
              <Sparkles size={14} />
              <span className="text-xs font-semibold uppercase tracking-tighter2">Agent</span>
            </div>
            <div className="mt-2 text-sm text-muted">
              Open a project to start an agent session, run snapshots, and ship changes.
            </div>
          </div>
        </>
      ) : null}

      {projectDialog ? (
        <Modal title="New project" onClose={() => setProjectDialog(false)}>
          <form className="grid gap-4" onSubmit={handleCreateProject}>
            <TextInput label="Project name" name="name" placeholder="frontend" required autoFocus />
            <label className="grid gap-1.5 text-xs font-medium uppercase tracking-tightish text-muted">
              <span>Runtime</span>
              <select name="runtimeKind" className={selectClass}>
                {runtimeKinds.map((runtime) => (
                  <option key={runtime} value={runtime}>
                    {runtime}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setProjectDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" icon={<Plus size={15} />}>
                Create project
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {serviceDialog && workspace ? (
        <Modal title="Service catalog" onClose={() => setServiceDialog(false)} size="lg">
          <ServiceWizard
            templates={templates}
            loading={templatesLoading}
            onCancel={() => setServiceDialog(false)}
            onSubmit={async (input) => {
              const response = await createService({
                workspaceId: workspace.id,
                name: input.name,
                templateId: input.templateId,
                config: input.config
              });
              return {
                serviceId: response.service.id,
                credentials: response.credentials
              };
            }}
            onComplete={(result) => {
              setServiceDialog(false);
              navigate(`/workspaces/${workspace.id}/services/${result.serviceId}`);
            }}
          />
        </Modal>
      ) : null}
    </WorkspaceLayout>
  );
}

function WorkspaceHeader({ workspace }: { workspace: Workspace }) {
  return (
    <div className="mb-7 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-dim">
        <Boxes size={12} className="text-accent" />
        <span className="uppercase tracking-tighter2">Workspace</span>
        <span>·</span>
        <span className="font-mono">{workspace.slug}</span>
      </div>
      <h1 className="text-3xl font-semibold tracking-tighter2 text-ink">{workspace.name}</h1>
      {workspace.description ? <p className="max-w-2xl text-sm text-muted">{workspace.description}</p> : null}
    </div>
  );
}

function SectionPanel({
  title,
  hint,
  action,
  children
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-hairline bg-surface p-5">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-medium uppercase tracking-tightish text-muted">{title}</h2>
          {hint ? <span className="text-[10px] uppercase tracking-tighter2 text-dim">{hint}</span> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint: string }) {
  return (
    <div className="grid place-items-center rounded-lg border border-dashed border-line bg-bg/30 p-8 text-center">
      <span className="text-dim">{icon}</span>
      <div className="mt-3 text-sm text-ink">{title}</div>
      <div className="mt-1 max-w-xs text-xs text-muted">{hint}</div>
    </div>
  );
}

function ProjectRow({ project, onOpen }: { project: Project; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="focus-ring group flex w-full items-center justify-between gap-3 rounded-lg border border-hairline bg-elevated px-4 py-3 text-left transition-colors hover:border-line2 hover:bg-raised"
    >
      <div className="flex items-center gap-3">
        <span className="grid h-8 w-8 place-items-center rounded-md border border-line bg-surface text-muted group-hover:text-accent">
          <FolderGit2 size={15} />
        </span>
        <div>
          <div className="text-sm font-medium text-ink">{project.name}</div>
          <div className="font-mono text-[11px] text-dim">{project.sourcePath}</div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-[10px] uppercase tracking-tighter2 text-muted">
          {project.runtimeKind}
        </span>
        <ArrowUpRight size={14} className="text-dim transition-colors group-hover:text-ink" />
      </div>
    </button>
  );
}

function ServiceRow({ service, onOpen }: { service: WorkspaceService; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="focus-ring group flex w-full items-center justify-between gap-3 rounded-lg border border-hairline bg-elevated px-4 py-3 text-left transition-colors hover:border-line2 hover:bg-raised"
    >
      <div className="flex items-center gap-3">
        <span className="grid h-8 w-8 place-items-center rounded-md border border-line bg-surface text-accent">
          <Database size={15} />
        </span>
        <div>
          <div className="text-sm font-medium text-ink">{service.name}</div>
          <div className="font-mono text-[11px] text-dim">
            {service.internalHost}
            {service.internalPort ? `:${service.internalPort}` : ""}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <StatusDot status={service.lastStatus} />
        <span className="rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-[10px] uppercase tracking-tighter2 text-muted">
          {service.kind.replace("database_", "")}
        </span>
        <ArrowUpRight size={14} className="text-dim transition-colors group-hover:text-ink" />
      </div>
    </button>
  );
}

function StatusDot({ status }: { status: ServiceStatus }) {
  const tone = statusTone(status);
  return (
    <span
      title={status}
      className={`inline-flex h-1.5 w-1.5 rounded-full ${tone.dot} ${tone.pulse}`}
    />
  );
}

function statusTone(status: ServiceStatus): { dot: string; pulse: string } {
  switch (status) {
    case "running":
      return { dot: "bg-green-400", pulse: "animate-pulse" };
    case "creating":
    case "restarting":
    case "pending":
      return { dot: "bg-yellow-400", pulse: "animate-pulse" };
    case "error":
      return { dot: "bg-rose-400", pulse: "" };
    case "stopped":
    case "exited":
      return { dot: "bg-dim", pulse: "" };
    default:
      return { dot: "bg-line2", pulse: "" };
  }
}

function Modal({
  title,
  onClose,
  children,
  size = "md"
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: "md" | "lg";
}) {
  const maxWidth = size === "lg" ? "max-w-3xl" : "max-w-md";
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className={`w-full ${maxWidth} max-h-[90vh] overflow-y-auto rounded-xl border border-line bg-elevated p-6 shadow-2xl shadow-black/50`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tightish text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
