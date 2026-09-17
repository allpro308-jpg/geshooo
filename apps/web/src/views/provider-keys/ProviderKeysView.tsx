import { KeyRound, Plus } from "lucide-react";
import { FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { selectClass,TextInput } from "@/components/ui/FormField";
import { Section } from "@/components/ui/Section";
import { useProviderKeys } from "@/hooks/useProviderKeys";
import { errorMessage } from "@/utils/forms";

const providers = ["openai", "anthropic", "openrouter", "gemini", "mistral", "groq", "ollama", "custom_openai_compatible"];

export function ProviderKeysPage() {
  const { providerKeys: keys, error, setError, createProviderKey: createProviderKeyRecord } = useProviderKeys();

  async function createProviderKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      await createProviderKeyRecord({
        scopeType: "user",
        provider: String(formData.get("provider") ?? ""),
        label: String(formData.get("label") ?? ""),
        key: String(formData.get("key") ?? "")
      });
      form.reset();
    } catch (requestError) {
      setError(errorMessage(requestError, "Failed to create provider key."));
    }
  }

  return (
    <div>
      <div className="mb-7">
        <div className="text-[10px] font-semibold tracking-tighter2 text-accent">مفاتيحك الخاصة</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tighter2 text-ink">مفاتيح المزود</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          أحضر مفاتيح النماذج الخاصة بك. تُشفّر المفاتيح عند التخزين ولا تُعرض لك أبداً.
        </p>
      </div>

      {error ? (
        <div className="mb-5 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</div>
      ) : null}

      <Section title="إضافة مفتاح مزود">
        <form
          className="grid gap-3 rounded-xl border border-hairline bg-surface p-5 lg:grid-cols-[180px_1fr_1fr_auto]"
          onSubmit={createProviderKey}
        >
          <label className="grid gap-1.5 text-xs font-medium tracking-tightish text-muted">
            <span>المزود</span>
            <select name="provider" className={selectClass}>
              {providers.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
          </label>
          <TextInput label="التسمية" name="label" placeholder="OpenAI الشخصي" required />
          <TextInput label="المفتاح" name="key" type="password" autoComplete="off" required />
          <div className="flex items-end">
            <Button type="submit" icon={<Plus size={15} />} className="w-full lg:w-auto">
              إضافة مفتاح
            </Button>
          </div>
        </form>
      </Section>

      <Section title="المفاتيح المُعدّة">
        <div className="overflow-hidden rounded-xl border border-hairline bg-surface">
          {keys.length === 0 ? (
            <div className="p-6 text-sm text-muted">لا توجد مفاتيح مزود مُعدّة بعد.</div>
          ) : (
            <ul className="divide-y divide-hairline">
              {keys.map((key) => (
                <li key={key.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="flex items-center gap-3">
                    <span className="grid h-8 w-8 place-items-center rounded-md border border-line bg-elevated text-accent">
                      <KeyRound size={14} />
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-ink">{key.label}</div>
                      <div className="font-mono text-[11px] text-dim">
                        {key.provider} · {key.scopeType}
                      </div>
                    </div>
                  </div>
                  <div className="text-[11px] text-dim">{new Date(key.createdAt).toLocaleDateString()}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>
    </div>
  );
}
