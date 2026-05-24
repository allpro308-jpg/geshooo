import type { InferenceProvider } from "./types";

/**
 * Known default base URLs for popular providers. The host platform usually
 * overrides these via configuration, but the defaults let the registry seed
 * itself with sensible values.
 */
export const DEFAULT_PROVIDER_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
  xai: "https://api.x.ai/v1",
  deepseek: "https://api.deepseek.com/v1",
  ollama: "http://localhost:11434/v1"
};

export const DEFAULT_PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
  groq: "Groq",
  google: "Google AI",
  xai: "xAI",
  deepseek: "DeepSeek",
  ollama: "Ollama"
};

/**
 * In-memory provider registry. Holds the runtime list of providers the host
 * platform wants to expose. The platform is responsible for persistence; the
 * registry is a pure cache plus a few helpers.
 */
export class ProviderRegistry {
  private providers = new Map<string, InferenceProvider>();

  register(provider: InferenceProvider): void {
    this.providers.set(provider.id, provider);
  }

  unregister(id: string): void {
    this.providers.delete(id);
  }

  clear(): void {
    this.providers.clear();
  }

  get(id: string): InferenceProvider | undefined {
    return this.providers.get(id);
  }

  list(): InferenceProvider[] {
    return Array.from(this.providers.values());
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }
}
