/**
 * Minimal OpenAI-compatible chat client for the analysis layers.
 *
 * Any provider that speaks `POST {base}/chat/completions` works, including the
 * free tiers of Google AI Studio (OpenAI compatibility endpoint), Groq,
 * Cerebras, OpenRouter's `:free` models, NVIDIA NIM, and a local Ollama.
 *
 * Configuration is opt-in. With no base URL and model, the analysis layers run
 * in rules mode and never touch the network. See backend/README.md.
 */

/**
 * Provider presets, so one variable is enough:
 *   FAREFAIR_LLM_PROVIDER=nvidia
 * Explicit FAREFAIR_LLM_BASE_URL / FAREFAIR_LLM_MODEL still win.
 */
export const PROVIDER_PRESETS = {
  nvidia: {
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'nvidia/nemotron-3-ultra-550b-a55b',
    // The 550B model writes ~2 tokens/s, so a full narrative needs 90-180 s.
    defaultTimeoutMs: 240000,
    // Turns off the reasoning trace: one round costs ~6 s instead of ~60 s.
    chatTemplateKwargs: { thinking: false },
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
  },
  cerebras: {
    baseUrl: 'https://api.cerebras.ai/v1',
    model: 'llama-3.3-70b',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
  },
  google: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.0-flash',
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.1',
  },
};

export function llmSettings(env = process.env) {
  const provider = String(env.FAREFAIR_LLM_PROVIDER || '')
    .trim()
    .toLowerCase();
  const preset = PROVIDER_PRESETS[provider] || null;
  const baseUrl = String(env.FAREFAIR_LLM_BASE_URL || preset?.baseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  const model = String(env.FAREFAIR_LLM_MODEL || preset?.model || '').trim();
  const apiKey = String(env.FAREFAIR_LLM_API_KEY || '').trim();
  const disabled = String(env.FAREFAIR_LLM_DISABLED || '').toLowerCase() === 'true';
  const rawTimeout = Number(
    env.FAREFAIR_LLM_TIMEOUT_MS || preset?.defaultTimeoutMs || 15000,
  );
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 15000;
  const jsonMode = String(env.FAREFAIR_LLM_JSON_MODE || 'true').toLowerCase() !== 'false';
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(baseUrl);

  return {
    enabled: Boolean(!disabled && baseUrl && model && (apiKey || local)),
    provider: provider || null,
    baseUrl,
    model,
    apiKey,
    timeoutMs,
    jsonMode,
    local,
    chatTemplateKwargs: preset?.chatTemplateKwargs || null,
  };
}

/** Human-readable reason the provider is off, for the API response. */
export function disabledReason(settings) {
  if (settings.enabled) return null;
  if (String(process.env.FAREFAIR_LLM_DISABLED || '').toLowerCase() === 'true') {
    return 'disabled by FAREFAIR_LLM_DISABLED';
  }
  if (!settings.baseUrl) return 'FAREFAIR_LLM_BASE_URL is not set';
  if (!settings.model) return 'FAREFAIR_LLM_MODEL is not set';
  if (!settings.apiKey && !settings.local) return 'FAREFAIR_LLM_API_KEY is not set';
  return 'provider configuration is incomplete';
}

/**
 * Ask the model for one JSON object. Returns `{ value, model, latencyMs }`.
 * Throws on network, timeout or malformed JSON; callers fall back to rules.
 */
export async function completeJson({ settings, system, user, fetchImpl } = {}) {
  const settingsValue = settings || llmSettings();
  if (!settingsValue.enabled) {
    throw new Error(disabledReason(settingsValue) || 'provider is not configured');
  }

  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new Error('fetch is unavailable in this runtime');
  }

  const startedAt = Date.now();
  let response = await post(settingsValue, system, user, doFetch, true);
  if (!response.ok && response.status === 400) {
    // Not every compatible provider accepts response_format.
    response = await post(settingsValue, system, user, doFetch, false);
  }

  if (!response.ok) {
    const body = await safeText(response);
    throw new Error(`provider returned HTTP ${response.status}${body ? `: ${body.slice(0, 160)}` : ''}`);
  }

  const payload = await response.json();
  const content =
    payload?.choices?.[0]?.message?.content ??
    payload?.choices?.[0]?.text ??
    '';
  const value = parseJsonObject(content);
  if (!value) {
    throw new Error('provider did not return a JSON object');
  }

  return {
    value,
    model: settingsValue.model,
    latencyMs: Date.now() - startedAt,
  };
}

function post(settings, system, user, fetchImpl, jsonMode) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
  const body = {
    model: settings.model,
    temperature: 0.1,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
  if (jsonMode && settings.jsonMode) {
    body.response_format = { type: 'json_object' };
  }
  if (settings.chatTemplateKwargs) {
    body.chat_template_kwargs = settings.chatTemplateKwargs;
  }
  const headers = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

  return fetchImpl(`${settings.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
}

function parseJsonObject(text) {
  if (!text || typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

async function safeText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
