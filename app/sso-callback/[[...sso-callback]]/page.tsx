import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

/**
 * OAuth return endpoint for the custom auto-Google sign-in flow.
 * Must stay a PUBLIC route (see proxy.ts).
 */
export default function SSOCallbackPage() {
  return <AuthenticateWithRedirectCallback />;
}
