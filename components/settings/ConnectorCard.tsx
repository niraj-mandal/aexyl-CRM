"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Loader2, Plug, PlugZap, Unplug } from "lucide-react";
import { connectConnectorAction, disconnectConnectorAction, verifyConnectorAction } from "@/app/actions/production.actions";

export interface ConnectorView {
  key: string;
  name: string;
  category: string;
  description: string;
  scopes: string[];
  setupHint: string;
  requiresExternalSetup: boolean;
  envConfigured: boolean;
  status: string;
  accountLabel: string | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  connectedAt: string | null;
}

export function ConnectorCard({ connector }: { connector: ConnectorView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justVerified, setJustVerified] = useState<string | null>(null);

  const connected = connector.status === "CONNECTED";

  const connect = () => {
    setError(null);
    startTransition(async () => {
      const res = await connectConnectorAction(connector.key);
      if (!res.ok) setError(res.error ?? "Connection failed");
      router.refresh();
    });
  };

  const disconnect = () => {
    setError(null);
    startTransition(async () => {
      await disconnectConnectorAction(connector.key);
      router.refresh();
    });
  };

  const verify = () => {
    setError(null);
    startTransition(async () => {
      const res = await verifyConnectorAction(connector.key);
      setJustVerified(res.ok ? "Verified just now" : (res.error ?? "Check failed"));
      router.refresh();
    });
  };

  const statusTone = connected
    ? "text-success border-success/40 bg-success/10"
    : connector.status === "ERROR"
      ? "text-danger border-danger/40 bg-danger/10"
      : connector.status === "UNAVAILABLE"
        ? "text-text-muted border-border-subtle bg-surface-high/50"
        : "text-warning border-warning/40 bg-warning/10";

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-low/80 backdrop-blur-xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-semibold text-text-primary">{connector.name}</h3>
            <span className={`rounded border px-1.5 py-0.5 font-mono-code text-[9px] ${statusTone}`}>
              {connector.status.replace("_", " ")}
            </span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">{connector.description}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {connector.scopes.map((s) => (
              <span key={s} className="rounded-full border border-border-subtle/60 px-2 py-0.5 font-mono-code text-[9px] text-text-muted">
                {s}
              </span>
            ))}
          </div>
          {connector.accountLabel && (
            <p className="mt-2 font-mono-code text-[10px] text-text-secondary">account: {connector.accountLabel}</p>
          )}
          {connector.lastError && (
            <p className="mt-2 flex items-start gap-1 text-[10px] text-danger">
              <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" /> {connector.lastError}
            </p>
          )}
          {justVerified && !error && <p className="mt-2 text-[10px] text-success">{justVerified}</p>}
          {error && <p className="mt-2 text-[10px] text-danger">{error}</p>}
          {!connector.envConfigured && (
            <p className="mt-2 text-[10px] text-text-muted/80">{connector.setupHint}</p>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
        {connector.envConfigured ? (
          connected ? (
            <>
              <button
                onClick={verify}
                disabled={pending}
                className="rounded-lg border border-border-subtle px-3 py-1.5 text-[11px] text-text-secondary transition-colors hover:bg-surface-high/50 disabled:opacity-50"
              >
                Verify
              </button>
              <button
                onClick={disconnect}
                disabled={pending}
                className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-[11px] text-text-secondary transition-colors hover:border-danger/40 hover:text-danger disabled:opacity-50"
              >
                <Unplug className="h-3.5 w-3.5" /> Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={connect}
              disabled={pending}
              className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/15 px-3 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/25 disabled:opacity-50"
            >
              <PlugZap className="h-3.5 w-3.5" /> Connect
            </button>
          )
        ) : (
          <span className="flex items-center gap-1.5 text-[10px] text-text-muted">
            <Plug className="h-3 w-3" />
            {connector.requiresExternalSetup ? "External setup required" : "Not configured"}
          </span>
        )}
      </div>
    </div>
  );
}
