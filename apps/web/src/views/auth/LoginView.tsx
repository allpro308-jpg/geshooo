import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { LogoMark } from "@/components/layout/Logo";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/FormField";
import { useAuth } from "@/hooks/useAuth";

export function LoginPage() {
  const navigate = useNavigate();
  const { user, needsSetup, login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (needsSetup) {
    return <Navigate to="/setup" replace />;
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      await login(String(formData.get("email") ?? ""), String(formData.get("password") ?? ""));
      navigate("/dashboard", { replace: true });
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Login failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-bg px-4 py-10">
      <div className="absolute inset-0 subtle-grid opacity-50" />
      <div
        className="pointer-events-none absolute -top-32 right-1/2 h-[420px] w-[420px] translate-x-1/2 rounded-full opacity-20 blur-3xl"
        style={{ background: "radial-gradient(circle, #ec4899 0%, transparent 70%)" }}
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark />
          <h1 className="mt-4 text-2xl font-semibold tracking-tighter2 text-ink">Welcome back</h1>
          <p className="mt-1.5 text-sm text-muted">Sign in to your singulary instance.</p>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-6 shadow-2xl shadow-black/30">
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <TextInput label="Email" name="email" type="email" autoComplete="email" required autoFocus />
            <TextInput label="Password" name="password" type="password" autoComplete="current-password" required />
            {error ? (
              <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</div>
            ) : null}
            <Button type="submit" disabled={isSubmitting} className="mt-1 w-full">
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>
        <div className="mt-6 text-center text-[11px] uppercase tracking-tighter2 text-dim">
          Self-hosted · BYOK · Docker-native
        </div>
      </div>
    </div>
  );
}
