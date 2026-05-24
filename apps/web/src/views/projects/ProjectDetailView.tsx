import type { Project } from "@singulary/shared";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { WorkspaceLayout } from "@/components/layout/WorkspaceLayout";
import { projectsService } from "@/services/projects.service";
import { errorMessage } from "@/utils/forms";

import { CodeTab } from "./CodeTab";
import { EnvironmentTab } from "./EnvironmentTab";
import { PreviewTab } from "./PreviewTab";
import { SettingsTab } from "./SettingsTab";
import { SnapshotsTab } from "./SnapshotsTab";
import { parseTab, type ProjectTab } from "./tabs";

export function ProjectDetailPage() {
  const { projectId } = useParams<{ id: string; projectId: string }>();
  const [searchParams] = useSearchParams();
  const tab = parseTab(searchParams.get("tab"));

  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    projectsService
      .get(projectId)
      .then((response) => setProject(response.project))
      .catch((requestError) => setError(errorMessage(requestError, "Failed to load project.")));
  }, [projectId]);

  const content = useMemo(() => {
    if (!projectId || !project) {
      return (
        <div className="grid h-full place-items-center text-muted">
          <Loader2 size={20} className="animate-spin" />
        </div>
      );
    }
    if (tab === "code") return <CodeTab projectId={projectId} />;
    if (tab === "preview") return <PreviewTab project={project} />;
    if (tab === "snapshots") return <SnapshotsTab projectId={projectId} />;
    if (tab === "environment") {
      return (
        <div className="mx-auto w-full max-w-4xl overflow-y-auto px-6 py-8">
          <EnvironmentTab projectId={projectId} />
        </div>
      );
    }
    if (tab === "settings") {
      return (
        <div className="h-full overflow-y-auto">
          <SettingsTab project={project} onProjectChange={setProject} />
        </div>
      );
    }
    return <ComingSoon tab={tab} />;
  }, [tab, projectId, project]);

  return (
    <WorkspaceLayout>
      {error ? (
        <div className="px-5 pt-3">
          <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            <AlertTriangle size={14} />
            {error}
          </div>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">{content}</div>
    </WorkspaceLayout>
  );
}

function ComingSoon({ tab }: { tab: ProjectTab }) {
  const copy: Record<ProjectTab, { title: string; hint: string }> = {
    code: { title: "Code", hint: "" },
    environment: { title: "Environment", hint: "" },
    preview: { title: "Preview", hint: "" },
    settings: { title: "Settings", hint: "" },
    snapshots: { title: "Snapshots", hint: "" },
    connections: {
      title: "Connections",
      hint: "Wire this project to workspace services and other projects via env aliases."
    }
  };
  const data = copy[tab];

  return (
    <div className="mx-auto grid h-full max-w-2xl place-items-center px-6 py-16 text-center">
      <Sparkles size={20} className="text-accent" />
      <div className="mt-3 text-base font-semibold tracking-tightish text-ink">{data.title}</div>
      <div className="mt-1 max-w-md text-sm text-muted">{data.hint}</div>
      <div className="mt-4 rounded-full border border-accent/30 bg-accentSoft px-3 py-1 text-[10px] font-semibold uppercase tracking-tighter2 text-accent">
        Coming soon
      </div>
    </div>
  );
}
