import {
  DEFAULT_PROVIDER_LABELS,
  DEFAULT_PROVIDER_URLS,
  InferenceClient,
  type InferenceProvider,
  ModelInfo,
  ProviderRegistry} from "@singulary/inference";

import { db } from "@/db/database";
import { decryptSecret } from "@/shared/crypto/secrets";
import { HttpError } from "@/shared/errors/http-error";

/**
 * Bridge between persistent DB rows (provider_configs + provider_keys) and the
 * pure `@singulary/inference` package. The platform owns secrets and policies;
 * inference only knows about base URLs, keys, and HTTP.
 */

type ProviderConfigRow = {
  id: string;
  provider: string;
  label: string;
  base_url: string;
  encrypted_api_key: string;
  enabled: number;
};

type ProviderKeyRow = {
  id: string;
  scope_type: string;
  scope_id: string | null;
  provider: string;
  label: string;
  encrypted_key: string;
};

export interface ResolvedProvider {
  client: InferenceClient;
  /** Canonical provider name (e.g. "openai"), used for usage_records + policies. */
  providerName: string;
  /** Whether this was resolved from a personal BYOK key. */
  isPersonal: boolean;
}

const registry = new ProviderRegistry();

function buildProvider(
  id: string,
  providerName: string,
  apiKey: string,
  baseUrl: string,
  label?: string
): InferenceProvider {
  return {
    id,
    label: label ?? providerName,
    baseUrl,
    apiKey,
    // Tag the underlying provider name so the registry can be inspected later.
    headers: { "x-singulary-provider": providerName }
  };
}

function resolveBaseUrlFor(providerName: string): string | null {
  const config = db.prepare("SELECT base_url FROM provider_configs WHERE provider = ?").get(providerName) as
    | { base_url: string }
    | undefined;
  return config?.base_url ?? DEFAULT_PROVIDER_URLS[providerName] ?? null;
}

/**
 * Resolve a provider/key reference into an InferenceClient.
 *
 * `idOrName` is either:
 *   - the id of a personal `provider_keys` row (`key_xxx`)
 *   - a canonical provider name (e.g. "openai") matching a `provider_configs` row
 */
export function resolveInferenceClient(idOrName: string): ResolvedProvider {
  // 1) Personal BYOK key by id
  const personal = db
    .prepare("SELECT id, scope_type, scope_id, provider, label, encrypted_key FROM provider_keys WHERE id = ?")
    .get(idOrName) as ProviderKeyRow | undefined;

  if (personal) {
    const baseUrl = resolveBaseUrlFor(personal.provider);
    if (!baseUrl) {
      throw new HttpError(400, "provider_base_url_missing", `No base URL configured for provider ${personal.provider}.`);
    }
    const provider = buildProvider(
      personal.id,
      personal.provider,
      decryptSecret(personal.encrypted_key),
      baseUrl,
      personal.label
    );
    registry.register(provider);
    return { client: new InferenceClient(provider), providerName: personal.provider, isPersonal: true };
  }

  // 2) Global provider config by name
  const config = db.prepare("SELECT * FROM provider_configs WHERE provider = ? AND enabled = 1").get(idOrName) as
    | ProviderConfigRow
    | undefined;

  if (!config) {
    throw new HttpError(404, "provider_not_configured", `Provider '${idOrName}' is not configured or is disabled.`);
  }

  const provider = buildProvider(
    config.provider,
    config.provider,
    decryptSecret(config.encrypted_api_key),
    config.base_url,
    config.label
  );
  registry.register(provider);
  return { client: new InferenceClient(provider), providerName: config.provider, isPersonal: false };
}

// --- model discovery + caching -------------------------------------------

type ModelsCacheEntry = {
  expiresAt: number;
  models: ModelInfo[];
};

const modelsCache = new Map<string, ModelsCacheEntry>();
const MODELS_TTL_MS = 5 * 60 * 1000;

export async function listProviderModelsRaw(idOrName: string): Promise<ModelInfo[]> {
  const cached = modelsCache.get(idOrName);
  if (cached && cached.expiresAt > Date.now()) return cached.models;

  try {
    const { client } = resolveInferenceClient(idOrName);
    const models = await client.listModels({ timeoutMs: 5000 });
    modelsCache.set(idOrName, { models, expiresAt: Date.now() + MODELS_TTL_MS });
    return models;
  } catch (error) {
    if (cached) return cached.models; // stale-while-error
    return [];
  }
}

export function invalidateModelsCache(idOrName?: string): void {
  if (idOrName) modelsCache.delete(idOrName);
  else modelsCache.clear();
}

export function getProviderLabel(providerName: string): string {
  const row = db.prepare("SELECT label FROM provider_configs WHERE provider = ?").get(providerName) as
    | { label: string }
    | undefined;
  return row?.label ?? DEFAULT_PROVIDER_LABELS[providerName] ?? providerName;
}

export function defaultProviderUrl(providerName: string): string | null {
  return DEFAULT_PROVIDER_URLS[providerName] ?? null;
}

export { registry as inferenceRegistry };
