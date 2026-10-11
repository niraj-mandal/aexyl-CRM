/**
 * Provider-agnostic LLM layer for Aexyl intelligence.
 *
 * Activation is purely env-driven — add ANY ONE of these keys to `.env.local`
 * and the copilot upgrades automatically (no code changes):
 *   OPENAI_API_KEY        -> gpt-4o-mini        (default, override AEXYL_LLM_MODEL)
 *   ANTHROPIC_API_KEY     -> claude-3-5-haiku   (default, override AEXYL_LLM_MODEL)
 *   GEMINI_API_KEY        -> gemini-2.0-flash
 *   OPENROUTER_API_KEY    -> free Gemma/dots vision-capable models (with fallbacks)
 *
 * Every call is fail-closed: any provider error resolves to `{ ok: false }`
 * and callers fall back to the deterministic engine. The copilot NEVER breaks
 * because a provider is down, misconfigured, or missing.
 */

export interface LlmStatus {
  available: boolean;
  provider: "openai" | "anthropic" | "gemini" | "openrouter" | null;
  model: string | null;
}

export interface LlmResult {
  ok: boolean;
  text?: string;
  error?: string;
}

const TIMEOUT_MS = 25_000;
const VISION_TIMEOUT_MS = 45_000;

/** A base64-encoded image (no data: prefix) sent alongside the user prompt. */
export interface LlmImage {
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  data: string;
}

const DEFAULT_VISION_MODELS: Record<string, string> = {
  openrouter: "google/gemma-4-31b-it:free",
  openai: "gpt-4o-mini",
};

// Free OpenRouter vision models are often rate-limited; OpenRouter tries these in order.
// (Not "openrouter/free": it can route to a safety classifier that never reads the image.)
const OPENROUTER_FREE_VISION_FALLBACKS = [
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "dots-studio/dots-3-note-preview:free",
];

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
  gemini: "gemini-2.0-flash",
  // Free models (OpenRouter falls through the list on rate limits); override with AEXYL_LLM_MODEL.
  openrouter: OPENROUTER_FREE_VISION_FALLBACKS[0],
};

// A provider whose key is rejected (401/403) is skipped for a while instead of failing every call.
const REJECTED_PROVIDER_TTL_MS = 10 * 60_000;
const rejectedProviders = new Map<string, number>();

export class LlmService {
  /** Which provider (if any) is configured right now. */
  static getStatus(): LlmStatus {
    const has = (k: string) => Boolean(process.env[k]?.trim());
    if (has("OPENAI_API_KEY"))
      return { available: true, provider: "openai", model: process.env.AEXYL_LLM_MODEL || DEFAULT_MODELS.openai };
    if (has("ANTHROPIC_API_KEY"))
      return { available: true, provider: "anthropic", model: process.env.AEXYL_LLM_MODEL || DEFAULT_MODELS.anthropic };
    if (has("GEMINI_API_KEY"))
      return { available: true, provider: "gemini", model: process.env.AEXYL_LLM_MODEL || DEFAULT_MODELS.gemini };
    if (has("OPENROUTER_API_KEY"))
      return { available: true, provider: "openrouter", model: process.env.AEXYL_LLM_MODEL || DEFAULT_MODELS.openrouter };
    return { available: false, provider: null, model: null };
  }

  /** Which provider reads images (screenshots). Override the model with AEXYL_VISION_MODEL. */
  static getVisionStatus(): LlmStatus {
    const has = (k: string) => Boolean(process.env[k]?.trim());
    const override = process.env.AEXYL_VISION_MODEL?.trim();
    if (has("OPENROUTER_API_KEY"))
      return { available: true, provider: "openrouter", model: override || DEFAULT_VISION_MODELS.openrouter };
    if (has("OPENAI_API_KEY"))
      return { available: true, provider: "openai", model: override || DEFAULT_VISION_MODELS.openai };
    return { available: false, provider: null, model: null };
  }

  /**
   * Requests a completion that must be a single JSON object.
   * System + user prompts; temperature kept low for operational answers.
   * With images, the request goes to the vision provider instead.
   */
  static async completeJson(system: string, user: string, images: LlmImage[] = []): Promise<LlmResult> {
    if (images.length > 0) return LlmService.completeVisionJson(system, user, images);
    const providers = LlmService.configuredProviders();
    if (providers.length === 0) {
      return { ok: false, error: "No LLM provider configured" };
    }
    // Try providers in priority order, so one bad key doesn't take the whole copilot down.
    let last: LlmResult = { ok: false, error: "All LLM providers failed" };
    for (const [i, provider] of providers.entries()) {
      const rejectedAt = rejectedProviders.get(provider);
      if (rejectedAt && Date.now() - rejectedAt < REJECTED_PROVIDER_TTL_MS) continue;
      const model = (i === 0 && process.env.AEXYL_LLM_MODEL?.trim()) || DEFAULT_MODELS[provider];
      try {
        last = await LlmService.callProvider(provider, model, system, user);
      } catch (error) {
        last = { ok: false, error: error instanceof Error ? error.message : "LLM call failed" };
      }
      if (last.ok) return last;
      if (/^LLM HTTP (401|403)/.test(last.error ?? "")) rejectedProviders.set(provider, Date.now());
    }
    return last;
  }

  private static configuredProviders(): NonNullable<LlmStatus["provider"]>[] {
    const has = (k: string) => Boolean(process.env[k]?.trim());
    const order: [NonNullable<LlmStatus["provider"]>, string][] = [
      ["openai", "OPENAI_API_KEY"],
      ["anthropic", "ANTHROPIC_API_KEY"],
      ["gemini", "GEMINI_API_KEY"],
      ["openrouter", "OPENROUTER_API_KEY"],
    ];
    return order.filter(([, key]) => has(key)).map(([p]) => p);
  }

  private static async callProvider(
    provider: NonNullable<LlmStatus["provider"]>,
    model: string,
    system: string,
    user: string
  ): Promise<LlmResult> {
    switch (provider) {
      case "openai":
        return LlmService.openai(model, system, user);
      case "openrouter": {
        const freeDefault = model === DEFAULT_MODELS.openrouter;
        return LlmService.openaiCompatible(
          "https://openrouter.ai/api/v1/chat/completions",
          process.env.OPENROUTER_API_KEY!.trim(),
          model,
          system,
          user,
          [],
          freeDefault ? OPENROUTER_FREE_VISION_FALLBACKS : undefined
        );
      }
      case "anthropic":
        return LlmService.anthropic(model, system, user);
      case "gemini":
        return LlmService.gemini(model, system, user);
    }
  }

  private static async completeVisionJson(system: string, user: string, images: LlmImage[]): Promise<LlmResult> {
    const status = LlmService.getVisionStatus();
    if (!status.available || !status.model) {
      return { ok: false, error: "No vision-capable LLM provider configured" };
    }
    const endpoint =
      status.provider === "openrouter"
        ? "https://openrouter.ai/api/v1/chat/completions"
        : "https://api.openai.com/v1/chat/completions";
    const key = (status.provider === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY)!.trim();
    const fallbacks =
      status.provider === "openrouter" && !process.env.AEXYL_VISION_MODEL?.trim()
        ? OPENROUTER_FREE_VISION_FALLBACKS
        : undefined;
    const attempt = async (): Promise<LlmResult> => {
      const r = await LlmService.openaiCompatible(endpoint, key, status.model!, system, user, images, fallbacks);
      if (r.ok && !LlmService.parseJsonLoose(r.text ?? "")) return { ok: false, error: "Vision model returned non-JSON" };
      return r;
    };
    try {
      let result = await attempt();
      // Free vision models are often briefly rate-limited or flaky upstream; one retry usually lands.
      if (!result.ok && /^(LLM HTTP (429|5\d\d)|Vision model returned non-JSON)/.test(result.error ?? "")) {
        await new Promise((r) => setTimeout(r, 2_000));
        result = await attempt();
      }
      return result;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Vision LLM call failed" };
    }
  }

  // --- Providers -----------------------------------------------------------

  private static async openai(model: string, system: string, user: string): Promise<LlmResult> {
    return LlmService.openaiCompatible(
      "https://api.openai.com/v1/chat/completions",
      process.env.OPENAI_API_KEY!.trim(),
      model,
      system,
      user
    );
  }

  private static async openaiCompatible(
    endpoint: string,
    apiKey: string,
    model: string,
    system: string,
    user: string,
    images: LlmImage[] = [],
    fallbackModels?: string[]
  ): Promise<LlmResult> {
    const userContent =
      images.length > 0
        ? [
            { type: "text", text: user },
            ...images.map((img) => ({
              type: "image_url",
              image_url: { url: `data:${img.mediaType};base64,${img.data}` },
            })),
          ]
        : user;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        ...(fallbackModels ? { models: fallbackModels } : { model }),
        temperature: 0.4,
        max_tokens: 1500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
      }),
      signal: AbortSignal.timeout(images.length > 0 ? VISION_TIMEOUT_MS : TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `LLM HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = json.choices?.[0]?.message?.content;
    return text ? { ok: true, text } : { ok: false, error: "Empty LLM response" };
  }

  private static async anthropic(model: string, system: string, user: string): Promise<LlmResult> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!.trim(),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        temperature: 0.4,
        system: `${system}\nRespond with a single JSON object and nothing else.`,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `LLM HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = json.content?.find((c) => c.type === "text")?.text;
    return text ? { ok: true, text } : { ok: false, error: "Empty LLM response" };
  }

  private static async gemini(model: string, system: string, user: string): Promise<LlmResult> {
    const key = process.env.GEMINI_API_KEY!.trim();
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 900,
            responseMimeType: "application/json",
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `LLM HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("");
    return text ? { ok: true, text } : { ok: false, error: "Empty LLM response" };
  }

  /**
   * Extracts the first JSON object from a model response, tolerating
   * markdown fences or stray prose around it.
   */
  static parseJsonLoose(text: string): Record<string, unknown> | null {
    const cleaned = text.replace(/```(?:json)?/gi, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}
