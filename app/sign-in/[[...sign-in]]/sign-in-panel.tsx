"use client";

import { SignIn } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { AutoGoogleSSO } from "./auto-google-sso";

/**
 * Sign-in panel: auto-Google by default (with Google's account chooser),
 * manual Clerk form only when explicitly requested via the "email instead"
 * toggle, the ?email=1 escape hatch, or after a failed SSO return.
 *
 * The prebuilt <SignIn /> Google button is NOT used for the Google path on
 * purpose: the SDK drops `prompt=select_account`, so Google shows its
 * identifier/password page instead of the account chooser.
 */
export function SignInPanel() {
  const params = useSearchParams();
  const errored = Boolean(params.get("sso_error") || params.get("error"));
  const [manualOverride, setManualOverride] = useState<boolean | null>(null);
  const manual = manualOverride ?? (errored || params.get("email") === "1");

  if (manual) {
    return (
      <div className="flex w-full max-w-md flex-col items-center gap-4">
        {errored && (
          <p className="text-muted-foreground text-sm">
            Google sign-in didn&apos;t complete. Use the form below, or{" "}
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={() => {
                setManualOverride(null);
                window.location.replace("/sign-in");
              }}
            >
              try Google again
            </button>
            .
          </p>
        )}
        <SignIn />
        {params.get("email") !== "1" && (
          <button
            type="button"
            className="text-muted-foreground text-sm underline underline-offset-4"
            onClick={() => setManualOverride(false)}
          >
            Use Google instead
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <AutoGoogleSSO onFail={() => setManualOverride(true)} />
      <button
        type="button"
        className="text-muted-foreground text-sm underline underline-offset-4"
        onClick={() => setManualOverride(true)}
      >
        Sign in with email instead
      </button>
    </div>
  );
}
