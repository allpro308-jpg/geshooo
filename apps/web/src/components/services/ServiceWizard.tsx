import type {
  ServiceCredential,
  ServiceTemplate,
  ServiceTemplateField
} from "@singulary/shared";
import {
  Boxes,
  Check,
  ChevronLeft,
  Copy,
  Database,
  Eye,
  EyeOff,
  HardDrive,
  Inbox,
  Loader2,
  Search,
  Sparkles,
  Zap
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/FormField";

const iconMap: Record<string, ReactNode> = {
  postgres: <Database size={18} />,
  mysql: <Database size={18} />,
  mariadb: <Database size={18} />,
  mongo: <Database size={18} />,
  redis: <Zap size={18} />,
  minio: <HardDrive size={18} />,
  rabbitmq: <Inbox size={18} />,
  meilisearch: <Search size={18} />
};

type WizardStep = "pick" | "configure" | "credentials";

export type ServiceWizardResult = {
  template: ServiceTemplate;
  serviceId: string;
  credentials: ServiceCredential[];
};

type ServiceWizardProps = {
  templates: ServiceTemplate[];
  loading: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    templateId: string;
    name: string;
    config: Record<string, unknown>;
  }) => Promise<{ serviceId: string; credentials: ServiceCredential[] }>;
  onComplete: (result: ServiceWizardResult) => void;
};

export function ServiceWizard({ templates, loading, onCancel, onSubmit, onComplete }: ServiceWizardProps) {
  const [step, setStep] = useState<WizardStep>("pick");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ServiceWizardResult | null>(null);

  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? null,
    [templates, selectedId]
  );

  useEffect(() => {
    if (!selected) return;
    const defaults: Record<string, string> = {};
    for (const field of selected.fields) {
      if (field.defaultValue !== undefined && field.defaultValue !== null) {
        defaults[field.key] = String(field.defaultValue);
      }
    }
    setConfig(defaults);
    if (!name) setName(selected.id.replace(/-/g, "_").split("_")[0]);
  }, [selected?.id]);

  function pick(templateId: string) {
    setSelectedId(templateId);
    setStep("configure");
  }

  async function submit() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await onSubmit({
        templateId: selected.id,
        name: name.trim() || selected.id,
        config
      });
      const wizardResult: ServiceWizardResult = {
        template: selected,
        serviceId: response.serviceId,
        credentials: response.credentials
      };
      setResult(wizardResult);
      setStep("credentials");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "فشل إنشاء الخدمة.");
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "pick") {
    return (
      <div>
        <Header
          title="إضافة خدمة"
          subtitle="اختر قالباً. تُنشأ البيانات السرية تلقائياً وتُخزن مشفّرة."
          onCancel={onCancel}
        />
        {loading ? (
          <div className="grid place-items-center py-16 text-muted">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => pick(template.id)}
                className="focus-ring group flex items-start gap-3 rounded-xl border border-hairline bg-surface p-4 text-left transition-all hover:border-line2 hover:bg-elevated"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line bg-elevated text-accent">
                  {iconMap[template.iconKey] ?? <Boxes size={18} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-ink">{template.name}</div>
                    <span className="rounded-md border border-line bg-elevated px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-tighter2 text-muted">
                      {template.category}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{template.description}</p>
                  <div className="mt-2 font-mono text-[10px] text-dim">{template.image}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (step === "configure" && selected) {
    return (
      <div>
        <Header
          title={`إعداد ${selected.name}`}
          subtitle={selected.description}
          back={() => setStep("pick")}
          onCancel={onCancel}
        />

        <div className="grid gap-4">
          <TextInput
            label="اسم الخدمة (اسم مستعار داخل مساحة العمل)"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="postgres"
            required
            autoFocus
          />

          <div className="rounded-xl border border-hairline bg-surface p-4">
            <div className="grid gap-4">
              {selected.fields.map((field) => (
                <FieldEditor
                  key={field.key}
                  field={field}
                  value={config[field.key] ?? ""}
                  onChange={(value) => setConfig((current) => ({ ...current, [field.key]: value }))}
                />
              ))}
            </div>
          </div>

          {error ? (
            <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</div>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setStep("pick")}>
              رجوع
            </Button>
            <Button onClick={submit} disabled={submitting} icon={<Sparkles size={14} />}>
              {submitting ? "جارٍ التجهيز…" : "إنشاء وتشغيل"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "credentials" && result) {
    return (
      <div>
        <Header
          title="الخدمة جاهزة"
          subtitle="انسخ البيانات السرية الآن — ستكون مرئية فقط من صفحة تفاصيل الخدمة بعد ذلك."
          onCancel={onCancel}
        />
        <div className="rounded-xl border border-accent/30 bg-accentSoft p-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-tighter2 text-accent">
            <Check size={14} /> البيانات السرية
          </div>
          <div className="grid gap-2">
            {result.credentials.map((credential) => (
              <CredentialRow key={credential.key} credential={credential} />
            ))}
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => onComplete(result)}>تم</Button>
        </div>
      </div>
    );
  }

  return null;
}

function Header({
  title,
  subtitle,
  back,
  onCancel
}: {
  title: string;
  subtitle: string;
  back?: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        {back ? (
          <button
            type="button"
            onClick={back}
            className="focus-ring mt-0.5 grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <ChevronLeft size={16} />
          </button>
        ) : null}
        <div>
          <h2 className="text-lg font-semibold tracking-tightish text-ink">{title}</h2>
          <p className="mt-1 max-w-md text-sm text-muted">{subtitle}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="focus-ring rounded-md text-xs text-dim transition-colors hover:text-ink"
      >
        Close
      </button>
    </div>
  );
}

function FieldEditor({
  field,
  value,
  onChange
}: {
  field: ServiceTemplateField;
  value: string;
  onChange: (value: string) => void;
}) {
  if (field.type === "password") {
    return <SecretField field={field} value={value} onChange={onChange} />;
  }
  if (field.type === "select" && field.options) {
    return (
      <label className="grid gap-1.5 text-xs font-medium uppercase tracking-tightish text-muted">
        <span>{field.label}</span>
        <select
          className="focus-ring h-10 rounded-lg border border-line bg-elevated px-3 text-sm text-ink"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <TextInput
      label={field.label}
      placeholder={field.placeholder ?? (field.defaultValue ? String(field.defaultValue) : undefined)}
      value={value}
      type={field.type === "number" ? "number" : "text"}
      min={field.min}
      max={field.max}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function SecretField({
  field,
  value,
  onChange
}: {
  field: ServiceTemplateField;
  value: string;
  onChange: (value: string) => void;
}) {
  const [reveal, setReveal] = useState(false);
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-tightish text-muted">
        <span>{field.label}</span>
        {field.generated ? (
          <span className="rounded-full border border-accent/30 bg-accentSoft px-2 py-0.5 text-[9px] uppercase tracking-tighter2 text-accent">
            Auto-generated
          </span>
        ) : null}
      </div>
      <div className="relative">
        <input
          type={reveal ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.generated ? "Will be generated if left empty" : field.placeholder}
          className="focus-ring h-10 w-full rounded-lg border border-line bg-elevated px-3 pr-10 text-sm text-ink"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => setReveal((current) => !current)}
          className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink"
        >
          {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );
}

function CredentialRow({ credential }: { credential: ServiceCredential }) {
  const [reveal, setReveal] = useState(!credential.secret);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(credential.value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  return (
    <div className="grid gap-1 rounded-lg border border-line bg-elevated px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-tighter2 text-dim">{credential.label}</div>
      <div className="flex items-center justify-between gap-2">
        <code className="truncate font-mono text-sm text-ink">
          {credential.secret && !reveal ? "•".repeat(12) : credential.value}
        </code>
        <div className="flex items-center gap-1">
          {credential.secret ? (
            <button
              type="button"
              onClick={() => setReveal((current) => !current)}
              className="focus-ring grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              {reveal ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          ) : null}
          <button
            type="button"
            onClick={copy}
            className="focus-ring grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            {copied ? <Check size={13} className="text-accent" /> : <Copy size={13} />}
          </button>
        </div>
      </div>
    </div>
  );
}
