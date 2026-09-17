import { Section } from "@/components/ui/Section";
import { useAuth } from "@/hooks/useAuth";

export function SettingsPage() {
  const { user } = useAuth();

  return (
    <div>
      <div className="mb-7">
        <div className="text-[10px] font-semibold tracking-tighter2 text-accent">الحساب</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tighter2 text-ink">الإعدادات</h1>
        <p className="mt-2 text-sm text-muted">حسابك في هذه النسخة المستضافة ذاتياً.</p>
      </div>
      <Section title="الملف الشخصي">
        <div className="rounded-xl border border-hairline bg-surface p-5">
          <dl className="grid gap-5 text-sm sm:grid-cols-3">
            <Field label="الاسم المعروض" value={user?.displayName} />
            <Field label="اسم المستخدم" value={user?.username ? `@${user.username}` : undefined} />
            <Field label="البريد الإلكتروني" value={user?.email} />
            <Field label="الدور" value={user?.role} mono />
            <Field label="معرف المستخدم" value={user?.id} mono />
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
