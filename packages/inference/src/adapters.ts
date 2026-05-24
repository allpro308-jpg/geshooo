import type { ProviderAdapter } from "./types";

/**
 * Default OpenAI-compatible adapter. Works for OpenAI, OpenRouter, Groq,
 * xAI, DeepSeek, Google's OpenAI-compat endpoint, Ollama in OpenAI mode,
 * and most "OpenAI-compatible" gateways.
 */
export const openAIAdapter: ProviderAdapter = {
  chatCompletionsUrl(baseUrl) {
    return `${stripTrailing(baseUrl)}/chat/completions`;
  },
  modelsUrl(baseUrl) {
    return `${stripTrailing(baseUrl)}/models`;
  },
  authHeader(apiKey) {
    return { Authorization: `Bearer ${apiKey}` };
  }
};

function stripTrailing(url: string): string {
  return url.replace(/\/+$/, "");
}
