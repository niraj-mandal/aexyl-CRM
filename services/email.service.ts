import { Resend } from "resend";

/**
 * Email delivery via Resend. Configuration is fully env-driven:
 *   RESEND_API_KEY   — required to send (from resend.com, free tier works)
 *   EMAIL_FROM       — "From" address, e.g. "Aexyl CRM <invites@yourdomain.com>"
 *                      (defaults to onboarding@resend.dev for quick trials)
 * When RESEND_API_KEY is missing the service reports isConfigured=false and
 * callers degrade gracefully instead of crashing.
 */

let cached: { client: Resend; key: string; from: string } | null = null;

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

function getClient(): { client: Resend; from: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!cached || cached.key !== apiKey) {
    cached = {
      client: new Resend(apiKey),
      key: apiKey,
      from: process.env.EMAIL_FROM || "Aexyl CRM <onboarding@resend.dev>",
    };
  }
  return cached;
}

export interface SendResult {
  sent: boolean;
  messageId?: string;
  error?: string;
}

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
 * than throwing when email is unconfigured or Resend rejects — the invite
 * row already exists and the UI always shows the copyable link as fallback.
 */
export async function sendInviteEmail(input: {
  to: string;
  inviteUrl: string;
  workspaceName: string;
  inviterName: string;
  expiresAt: Date;
}): Promise<SendResult> {
  const client = getClient();
  if (!client) {
    return { sent: false, error: "RESEND_API_KEY is not set — share the link manually for now." };
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

  try {
    const { data, error } = await client.client.emails.send({
      from: client.from,
      to: [input.to],
      subject: `You're invited to ${input.workspaceName} on Aexyl`,
      html,
    });
    if (error) {
      return { sent: false, error: error.message };
    }
    return { sent: true, messageId: data?.id };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : "Unknown Resend error",
    };
  }
}

/**
 * Sends a raw email via Resend. Used by agent communication tools (which may
 * only send after an approved, HIGH-risk approval flow). Returns sent=false
 * with a reason instead of throwing when unconfigured or rejected.
 */
export async function sendRawEmail(input: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<SendResult> {
  const client = getClient();
  if (!client) {
    return { sent: false, error: "RESEND_API_KEY is not set — email delivery unavailable." };
  }
  try {
    const { data, error } = await client.client.emails.send({
      from: client.from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    if (error) return { sent: false, error: error.message };
    return { sent: true, messageId: data?.id };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : "Unknown Resend error" };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
