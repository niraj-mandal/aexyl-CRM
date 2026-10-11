"use client";

import { ClerkLoaded, useClerk } from "@clerk/nextjs";
import { useEffect, useRef } from "react";
import { LoaderCircle } from "lucide-react";

/**
 * Auto-starts the Google SSO flow as soon as the sign-in page loads
 * (single-provider app, so there is no meaningful provider choice to make).
 *
 * Goes through an explicit signIn.create() + navigate instead of
 * `signIn.authenticateWithRedirect()` because that helper drops the
 * `oidcPrompt` parameter in this SDK version — without it Google skips the
 * account chooser and lands users on the identifier/password page.
 *
 * On any failure this calls `onFail` and the parent switches to the manual
 * form. Never retries automatically (no redirect loops).
 */
export function AutoGoogleSSO({ onFail }: { onFail: () => void }) {
  return (
    <ClerkLoaded>
      <AutoGoogleSSOStart onFail={onFail} />
    </ClerkLoaded>
  );
}

/** Same-origin `redirect_url` only (e.g. back to an invite link); never an external site. */
function safeReturnPath(): string {
  const raw = new URLSearchParams(window.location.search).get("redirect_url");
  if (!raw) return "/";
  try {
    const target = new URL(raw, window.location.origin);
    if (target.origin !== window.location.origin) return "/";
    if (target.pathname.startsWith("/sign-in") || target.pathname.startsWith("/sso-callback")) return "/";
    return target.pathname + target.search + target.hash;
  } catch {
    return "/";
  }
}

function AutoGoogleSSOStart({ onFail }: { onFail: () => void }) {
  const clerk = useClerk();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    if (!clerk.client) return;
    started.current = true;

    void (async () => {
      try {
        const signIn = await clerk.client!.signIn.create({
          strategy: "oauth_google",
          redirectUrl: `${window.location.origin}/sso-callback`,
          actionCompleteRedirectUrl: safeReturnPath(),
          // Forces Google's account picker every time.
          oidcPrompt: "select_account",
        });
        const redirect =
          signIn.firstFactorVerification.externalVerificationRedirectURL;
        if (redirect) {
          window.location.assign(redirect.toString());
        } else {
          onFail();
        }
      } catch {
        onFail();
      }
    })();
  }, [clerk, onFail]);

  return (
    <div className="text-muted-foreground flex flex-col items-center gap-3 py-8 text-sm">
      <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />
      <p>Redirecting you to Google to sign in…</p>
    </div>
  );
}
