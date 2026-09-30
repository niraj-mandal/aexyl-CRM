import { Suspense } from "react";
import { SignInPanel } from "./sign-in-panel";

/**
 * Sign-in page. Auto-starts the Google SSO flow with Google's account
 * chooser (see sign-in-panel.tsx / auto-google-sso.tsx); the manual email
 * form is one click away via the toggle, the ?email=1 URL, or after an
 * SSO failure.
 */
export default function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6">
      <Suspense fallback={null}>
        <SignInPanel />
      </Suspense>
    </div>
  );
}
