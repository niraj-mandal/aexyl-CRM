/**
 * Provider-agnostic LLM layer for Aexyl intelligence.
 *
 * Activation is purely env-driven — add ANY ONE of these keys to `.env.local`
 * and the copilot upgrades automatically (no code changes):
 *   OPENAI_API_KEY        -> gpt-4o-mini        (default, override AEXYL_LLM_MODEL)
 *   ANTHROPIC_API_KEY     -> claude-3-5-haiku   (default, override AEXYL_LLM_MODEL)
 *   GEMINI_API_KEY        -> gemini-2.0-flash
 *   OPENROUTER_API_KEY    -> meta-llama/llama-3.1-8b-instruct
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

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
  gemini: "gemini-2.0-flash",
  openrouter: "meta-llama/llama-3.1-8b-instruct",
};

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

  /**
   * Requests a completion that must be a single JSON object.
   * System + user prompts; temperature kept low for operational answers.
   */
  static async completeJson(system: string, user: string): Promise<LlmResult> {
    const status = LlmService.getStatus();
    if (!status.available || !status.provider) {
      return { ok: false, error: "No LLM provider configured" };
    }
    try {
      switch (status.provider) {
        case "openai":
          return await LlmService.openai(status.model!, system, user);
        case "openrouter":
          return await LlmService.openaiCompatible(
            "https://openrouter.ai/api/v1/chat/completions",
            process.env.OPENROUTER_API_KEY!.trim(),
            status.model!,
            system,
            user
          );
        case "anthropic":
          return await LlmService.anthropic(status.model!, system, user);
        case "gemini":
          return await LlmService.gemini(status.model!, system, user);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "LLM call failed";
      return { ok: false, error: message };
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
    user: string
  ): Promise<LlmResult> {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
        max_tokens: 900,
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
