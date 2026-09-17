import { Resend } from "resend";

/**
 * Email delivery — provider-agnostic facade. Configuration is fully env-driven:
 *
 *   EMAIL_PROVIDER   — optional explicit choice: "brevo" | "resend"
 *                      (default: Brevo if BREVO_API_KEY is set, else Resend)
 *   BREVO_API_KEY    — Brevo transactional key (app.brevo.com → SMTP & API)
 *   RESEND_API_KEY   — Resend key (resend.com, free tier works)
 *   EMAIL_FROM       — "From" address, e.g. "Aexyl CRM <invites@yourdomain.com>"
 *                      (defaults to onboarding@resend.dev — Brevo senders must
 *                      be verified in the Brevo dashboard)
 *
 * Both providers speak through sendEmailViaProvider(); callers only ever see
 * the exported functions below. When no key is configured the service reports
 * isConfigured=false and callers degrade gracefully instead of crashing.
 */

export type EmailProvider = "brevo" | "resend";

export interface SendResult {
  sent: boolean;
  messageId?: string;
  error?: string;
}

function envProvider(): EmailProvider | null {
  const explicit = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (explicit === "brevo") return process.env.BREVO_API_KEY ? "brevo" : null;
  if (explicit === "resend") return process.env.RESEND_API_KEY ? "resend" : null;
  // Auto: Brevo wins when both keys exist (explicit EMAIL_PROVIDER overrides).
  if (process.env.BREVO_API_KEY) return "brevo";
  if (process.env.RESEND_API_KEY) return "resend";
  return null;
}

/** Provider currently active, for UI/status surfaces. */
export function getEmailProvider(): EmailProvider | null {
  return envProvider();
}

export function isEmailConfigured(): boolean {
  return envProvider() !== null;
}

/** Parses "Name <addr@x>" or bare "addr@x" into Brevo's {name?, email} shape. */
export function parseFromAddress(from: string): { name?: string; email: string } {
  const match = from.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (match) {
    const name = match[1].replace(/^"|"$/g, "").trim();
    return { email: match[2].trim(), ...(name ? { name } : {}) };
  }
  return { email: from.trim() };
}

let cachedFrom: { raw: string; parsed: { name?: string; email: string } } | null = null;
function getFrom(): { name?: string; email: string } {
  const raw = process.env.EMAIL_FROM || "Aexyl CRM <onboarding@resend.dev>";
  if (!cachedFrom || cachedFrom.raw !== raw) {
    cachedFrom = { raw, parsed: parseFromAddress(raw) };
  }
  return cachedFrom.parsed;
}

// ── Brevo (HTTP API — no SDK dependency) ────────────────────────────────────

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

async function sendViaBrevo(input: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<SendResult> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { sent: false, error: "BREVO_API_KEY is not set." };
  const from = getFrom();

  try {
    const res = await fetch(BREVO_API_URL, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: from,
        to: [{ email: input.to }],
        subject: input.subject,
        htmlContent: input.html,
        ...(input.text ? { textContent: input.text } : {}),
      }),
      // Fail well before a request could hang a server action.
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let detail = body.slice(0, 300);
      try {
        const json = JSON.parse(body) as { message?: string };
        if (json.message) detail = json.message;
      } catch {
        /* keep raw body excerpt */
      }
      return { sent: false, error: `Brevo API ${res.status}: ${detail}` };
    }
    const data = (await res.json()) as { messageId?: string };
    return { sent: true, messageId: data.messageId };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : "Unknown Brevo error",
    };
  }
}

// ── Resend (SDK) ─────────────────────────────────────────────────────────────

let cachedResend: { client: Resend; key: string } | null = null;

async function sendViaResend(input: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, error: "RESEND_API_KEY is not set." };
  if (!cachedResend || cachedResend.key !== apiKey) {
    cachedResend = { client: new Resend(apiKey), key: apiKey };
  }
  const from = getFrom();
  try {
    const { data, error } = await cachedResend.client.emails.send({
      from: from.name ? `${from.name} <${from.email}>` : from.email,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    if (error) return { sent: false, error: error.message };
    return { sent: true, messageId: data?.id };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : "Unknown Resend error",
    };
  }
}

/** Single dispatch point — every email Aexyl sends goes through here. */
export async function sendEmailViaProvider(input: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<SendResult> {
  const provider = envProvider();
  if (!provider) {
    return {
      sent: false,
      error:
        "No email provider configured — set BREVO_API_KEY (or RESEND_API_KEY) in .env.local.",
    };
  }
  return provider === "brevo" ? sendViaBrevo(input) : sendViaResend(input);
}

// ── Facade (unchanged public API — all existing call sites keep working) ────

function emailLayout(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#0d0e11;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0d0e11;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#1b1b1f;border:1px solid rgba(255,255,255,0.08);border-radius:12px;">
            <tr>
              <td style="padding:32px 32px 8px 32px;">
                <span style="font-size:12px;font-weight:700;letter-spacing:0.12em;color:#2b66ff;">AEXYL CRM</span>
                <h1 style="margin:12px 0 0 0;font-size:20px;color:#e3e2e6;">${title}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 32px 32px 32px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;border-top:1px solid rgba(255,255,255,0.08);">
                <p style="margin:0;font-size:11px;color:#8d90a1;">Sent by Aexyl CRM — you received this because someone invited you to a workspace.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function primaryButton(url: string, label: string): string {
  return `<a href="${url}" style="display:inline-block;background-color:#2b66ff;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;">${label}</a>
    <p style="margin:16px 0 0 0;font-size:12px;color:#8d90a1;word-break:break-all;">Or paste this link: ${url}</p>`;
}

/**
 * Sends the workspace invite email. Returns sent=false (with reason) rather
 * than throwing when email is unconfigured or the provider rejects — the
 * invite row already exists and the UI always shows the copyable link.
 */
export async function sendInviteEmail(input: {
  to: string;
  inviteUrl: string;
  workspaceName: string;
  inviterName: string;
  expiresAt: Date;
}): Promise<SendResult> {
  if (!isEmailConfigured()) {
    return { sent: false, error: "No email provider configured (BREVO_API_KEY / RESEND_API_KEY) — share the link manually for now." };
  }

  const expiry = input.expiresAt.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const html = emailLayout(
    `Join ${escapeHtml(input.workspaceName)} on Aexyl`,
    `<p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#c3c5d8;">
       ${escapeHtml(input.inviterName)} invited <strong style="color:#e3e2e6;">${escapeHtml(input.to)}</strong>
       to collaborate in the <strong style="color:#e3e2e6;">${escapeHtml(input.workspaceName)}</strong> workspace.
     </p>
     ${primaryButton(escapeHtml(input.inviteUrl), "Accept invitation")}
     <p style="margin:16px 0 0 0;font-size:12px;color:#8d90a1;">This link is single-use and expires ${expiry}.</p>`
  );

  return sendEmailViaProvider({
    to: input.to,
    subject: `You're invited to ${input.workspaceName} on Aexyl`,
    html,
  });
}

/**
 * Sends a raw email. Used by agent communication tools (which may only send
 * after an approved, HIGH-risk approval flow). Returns sent=false with a
 * reason instead of throwing when unconfigured or rejected.
 */
export async function sendRawEmail(input: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<SendResult> {
  if (!isEmailConfigured()) {
    return { sent: false, error: "No email provider configured (BREVO_API_KEY / RESEND_API_KEY) — email delivery unavailable." };
  }
  return sendEmailViaProvider(input);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
