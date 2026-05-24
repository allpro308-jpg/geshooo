/**
 * Simple per-model pricing table. Values are USD per million tokens.
 * Missing models default to 0 (unknown price).
 */

type Pricing = { input: number; output: number; cachedInput?: number };

// Heuristic: identify the model family by substring match. First match wins.
const PRICING_RULES: Array<{ match: RegExp; price: Pricing }> = [
  // OpenAI
  { match: /gpt-5/i, price: { input: 5, output: 15 } },
  { match: /o3-mini|o4-mini/i, price: { input: 1.1, output: 4.4 } },
  { match: /o3|o1/i, price: { input: 15, output: 60 } },
  { match: /gpt-4\.1-mini/i, price: { input: 0.4, output: 1.6 } },
  { match: /gpt-4\.1/i, price: { input: 2, output: 8 } },
  { match: /gpt-4o-mini/i, price: { input: 0.15, output: 0.6 } },
  { match: /gpt-4o/i, price: { input: 2.5, output: 10 } },
  { match: /gpt-4-turbo/i, price: { input: 10, output: 30 } },
  { match: /gpt-3\.5-turbo/i, price: { input: 0.5, output: 1.5 } },

  // Anthropic / Claude family
  { match: /claude-opus-4-7|claude-4\.7-opus/i, price: { input: 15, output: 75 } },
  { match: /claude-opus/i, price: { input: 15, output: 75 } },
  { match: /claude-sonnet-4-6|claude-4\.6-sonnet/i, price: { input: 3, output: 15 } },
  { match: /claude-sonnet-4|claude-4-sonnet|claude-sonnet/i, price: { input: 3, output: 15 } },
  { match: /claude-haiku-4-5|claude-4\.5-haiku|claude-haiku/i, price: { input: 1, output: 5 } },
  { match: /claude-3-?5-sonnet/i, price: { input: 3, output: 15 } },
  { match: /claude-3-?5-haiku/i, price: { input: 0.8, output: 4 } },

  // Gemini
  { match: /gemini-1\.5-pro/i, price: { input: 1.25, output: 5 } },
  { match: /gemini-1\.5-flash/i, price: { input: 0.075, output: 0.3 } },
  { match: /gemini-2.*flash/i, price: { input: 0.1, output: 0.4 } },
  { match: /gemini-2.*pro/i, price: { input: 1.25, output: 5 } },

  // xAI
  { match: /grok-4/i, price: { input: 3, output: 15 } },
  { match: /grok-3|grok-beta/i, price: { input: 2, output: 10 } },

  // DeepSeek
  { match: /deepseek-reasoner/i, price: { input: 0.55, output: 2.19 } },
  { match: /deepseek-chat|deepseek-v3/i, price: { input: 0.27, output: 1.1 } },

  // Groq Llama
  { match: /llama-3\.3-70b/i, price: { input: 0.59, output: 0.79 } },
  { match: /llama-3\.1-70b/i, price: { input: 0.59, output: 0.79 } },
  { match: /llama-3\.1-8b/i, price: { input: 0.05, output: 0.08 } },
  { match: /mixtral-8x7b/i, price: { input: 0.24, output: 0.24 } },

  // Ollama / local: free
  { match: /^ollama/i, price: { input: 0, output: 0 } }
];

export function estimateCostUsd(model: string, input: number, output: number, cached = 0): number {
  const pricing = lookupPricing(model);
  if (!pricing) return 0;
  const billableInput = Math.max(0, input - cached);
  const cost =
    (billableInput / 1_000_000) * pricing.input +
    (cached / 1_000_000) * (pricing.cachedInput ?? pricing.input / 2) +
    (output / 1_000_000) * pricing.output;
  return Math.round(cost * 1_000_000) / 1_000_000; // 6-decimal precision
}

function lookupPricing(model: string): Pricing | null {
  for (const rule of PRICING_RULES) {
    if (rule.match.test(model)) return rule.price;
  }
  return null;
}
