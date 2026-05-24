import type { Project, ProjectTemplate } from "@singulary/shared";
import { Boxes, Save, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { selectClass,TextInput } from "@/components/ui/FormField";
import { projectsService } from "@/services/projects.service";
import { errorMessage } from "@/utils/forms";

type SettingsTabProps = {
  project: Project;
  onProjectChange: (project: Project) => void;
};

export function SettingsTab({ project, onProjectChange }: SettingsTabProps) {
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [draft, setDraft] = useState({
    name: project.name,
    templateId: project.templateId ?? "",
    installCommand: project.installCommand ?? "",
    startCommand: project.startCommand ?? ""
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    projectsService
      .listTemplates()
      .then((response) => setTemplates(response.templates))
      .catch(() => setTemplates([]));
  }, []);

  useEffect(() => {
    setDraft({
      name: project.name,
      templateId: project.templateId ?? "",
      installCommand: project.installCommand ?? "",
      startCommand: project.startCommand ?? ""
    });
  }, [project.id]);

  const selectedTemplate = templates.find((template) => template.id === draft.templateId) ?? null;

  function pickTemplate(id: string) {
    const template = templates.find((entry) => entry.id === id);
    if (!template) {
      setDraft((current) => ({ ...current, templateId: id }));
      return;
    }
    setDraft((current) => ({
      ...current,
      templateId: id,
      // Adopt defaults only when fields are empty so we don't overwrite a custom command.
      installCommand: current.installCommand || template.installCommand || "",
      startCommand: current.startCommand || template.startCommand || ""
    }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await projectsService.update(project.id, {
        name: draft.name.trim() || undefined,
        templateId: draft.templateId || null,
        installCommand: draft.installCommand.trim() === "" ? null : draft.installCommand.trim(),
        startCommand: draft.startCommand.trim() === "" ? null : draft.startCommand.trim()
      });
      onProjectChange(response.project);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1500);
    } catch (requestError) {
      setError(errorMessage(requestError, "Failed to save settings."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <div className="mb-6">
        <div className="text-[10px] font-semibold uppercase tracking-tighter2 text-accent">Settings</div>
        <h2 className="mt-1 text-2xl font-semibold tracking-tighter2 text-ink">Runtime configuration</h2>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Pick the runtime image, then the install and start commands that run inside the container.
        </p>
      </div>

      <div className="grid gap-5 rounded-xl border border-hairline bg-surface p-5">
        <TextInput
          label="Project name"
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />

        <div className="grid gap-1.5">
          <div className="text-xs font-medium uppercase tracking-tightish text-muted">Template</div>
          <select
            value={draft.templateId}
            onChange={(event) => pickTemplate(event.target.value)}
            className={selectClass}
          >
            <option value="">Auto-detect from runtime</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} · {template.image}
              </option>
            ))}
          </select>
          {selectedTemplate ? <TemplateSummary template={selectedTemplate} /> : null}
        </div>

        <FieldWithDefault
          label="Install command"
          placeholder={selectedTemplate?.installCommand ?? "—"}
          value={draft.installCommand}
          onChange={(value) => setDraft({ ...draft, installCommand: value })}
          mono
          hint="Runs once on container boot before the start command."
        />

        <FieldWithDefault
          label="Start command"
          placeholder={selectedTemplate?.startCommand ?? "—"}
          value={draft.startCommand}
          onChange={(value) => setDraft({ ...draft, startCommand: value })}
          mono
          hint="The dev process. Bind to 0.0.0.0 so the preview can see it on whichever port you choose."
        />
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="mt-5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-dim">
          <Sparkles size={12} className="text-accent" />
          Ports are detected automatically from the container — no need to declare one here.
        </div>
        <div className="flex items-center gap-2">
          {savedFlash ? <span className="text-xs text-accent">Saved</span> : null}
          <Button icon={<Save size={14} />} onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TemplateSummary({ template }: { template: ProjectTemplate }) {
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-line bg-elevated p-3">
      <div className="flex items-center gap-2 text-xs">
        <Boxes size={13} className="text-accent" />
        <span className="font-medium text-ink">{template.name}</span>
        <span className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-tighter2 text-muted">
          {template.category}
        </span>
      </div>
      <div className="font-mono text-[11px] text-dim">{template.image}</div>
      <p className="text-xs text-muted">{template.description}</p>
      {template.hints.commonPorts.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1 text-[10px] text-dim">
          <span className="uppercase tracking-tighter2">Common ports</span>
          {template.hints.commonPorts.map((port) => (
            <span
              key={port}
              className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted"
            >
              {port}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FieldWithDefault({
  label,
  placeholder,
  value,
  onChange,
  mono = false,
  hint
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-tightish text-muted">{label}</div>
        {value === "" && placeholder && placeholder !== "—" ? (
          <span className="font-mono text-[10px] text-dim">default: {placeholder}</span>
        ) : null}
      </div>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`focus-ring h-10 w-full rounded-lg border border-line bg-elevated px-3 text-sm text-ink placeholder:text-dim ${
          mono ? "font-mono text-[12px]" : ""
        }`}
      />
      {hint ? <div className="mt-1 text-[11px] text-dim">{hint}</div> : null}
    </div>
  );
}
