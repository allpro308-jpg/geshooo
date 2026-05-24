import { Section } from "@/components/ui/Section";
import { useAuth } from "@/hooks/useAuth";

export function SettingsPage() {
  const { user } = useAuth();

  return (
    <div>
      <div className="mb-7">
        <div className="text-[10px] font-semibold uppercase tracking-tighter2 text-accent">Account</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tighter2 text-ink">Settings</h1>
        <p className="mt-2 text-sm text-muted">Your account on this self-hosted instance.</p>
      </div>
      <Section title="Profile">
        <div className="rounded-xl border border-hairline bg-surface p-5">
          <dl className="grid gap-5 text-sm sm:grid-cols-3">
            <Field label="Display name" value={user?.displayName} />
            <Field label="Username" value={user?.username ? `@${user.username}` : undefined} />
            <Field label="Email" value={user?.email} />
            <Field label="Role" value={user?.role} mono />
            <Field label="User ID" value={user?.id} mono />
          </dl>
        </div>
      </Section>
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-tighter2 text-dim">{label}</dt>
      <dd className={`mt-1.5 text-sm text-ink ${mono ? "font-mono text-muted" : ""}`}>{value ?? "—"}</dd>
    </div>
  );
}
