"use client";

import { useState } from "react";
import { ArrowRight, Check, ExternalLink, RotateCw, ShieldCheck, X } from "lucide-react";
import type { Requirement, SetupStatus } from "@/lib/setup-status";
import { useToast } from "./toast";
import Image from "next/image";
import { PageBackground } from "./PageBackground";
import { CopyToggleIcon, neon } from "./ui";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

const ENV_TEMPLATE = "NEON_API_KEY=napi_...";

function copyViaSelection(text: string) {
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.cssText = "position:fixed;top:-9999px;opacity:0";
  document.body.appendChild(el);
  el.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  el.remove();
  return ok;
}

export function SetupLanding({ status }: { status: SetupStatus }) {
  const { requirements, loading, refresh, skip } = status;
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);

  const required = requirements.filter((r) => !r.optional);
  const satisfiedCount = required.filter((r) => r.satisfied).length;
  const busy = checking || loading;

  async function recheck() {
    setChecking(true);
    try {
      const next = await refresh();
      const missing = next.filter((r) => !r.optional && !r.satisfied);

      if (missing.length === 0) {
        toast({
          tone: "success",
          title: "All set",
          description: "Opening the advisor.",
        });
        return;
      }

      toast({
        tone: "warning",
        title: `${missing.length} of ${required.length} still missing`,
        description: missing.map((r) => r.envVar).join(", "),
      });
    } catch {
      toast({
        tone: "error",
        title: "Couldn't read configuration",
        description: "The connection check failed. Try again in a moment.",
      });
    } finally {
      setChecking(false);
    }
  }

  async function copyEnv() {
    try {
      await navigator.clipboard.writeText(ENV_TEMPLATE);
    } catch {
      if (!copyViaSelection(ENV_TEMPLATE)) {
        toast({
          tone: "error",
          title: "Couldn't copy",
          description: "Select the block below and copy it manually.",
        });
        return;
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="w-full flex-1 overflow-y-auto">
      <PageBackground />

      <div className="relative mx-auto flex min-h-full max-w-[880px] flex-col justify-center px-8 py-8">
        <Image
          src="/neonlabs-logo-light.svg"
          alt="Neon Labs"
          width={98}
          height={18}
          priority
          className="mb-6 h-[18px] w-auto self-start"
        />

        <h1 className="text-balance text-display-sm font-medium leading-[1.1] display-tight text-foreground sm:text-display">
          Know what breaks before you cut over.
        </h1>
        <p className="mt-3 max-w-[55ch] text-pretty text-body-lg leading-[1.6] text-[#f3f4f6]">
          Assess a Postgres major-version upgrade against your live Neon
          database, then run the migration end to end.
        </p>

        <Card className="gap-0 mt-8">
          <div className="flex items-start justify-between gap-4 border-b border-[#262727] p-4">
            <div className="min-w-0 flex-1">
              <h2 className={neon.h3}>Add your API key to .env.local</h2>
              <p className={`mt-0.5 text-caption ${neon.muted}`}>
                One key is enough. Projects and connection strings are read
                from the API as needed.
              </p>
            </div>
            <button
              type="button"
              onClick={copyEnv}
              aria-label={copied ? "Template copied" : "Copy .env.local template"}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full border border-[#262727] px-[18px] py-2 text-ui font-medium text-[#f3f4f6] transition-[scale,background-color,border-color] duration-150 ease-out hover:border-[#9ca3af] hover:bg-[#1a1b1b] active:scale-[0.96] ${neon.focusRing}`}
            >
              <CopyToggleIcon copied={copied} className="h-3.5 w-3.5" />
              <span className="grid text-center">
                <span aria-hidden className="col-start-1 row-start-1 invisible">
                  Copied
                </span>
                <span className="col-start-1 row-start-1">
                  {copied ? "Copied" : "Copy"}
                </span>
              </span>
            </button>
          </div>

          <div className="p-4">
            <pre className="overflow-x-auto rounded-[4px] border border-[#262727] bg-[#0c0d0d] px-3 py-2.5 font-mono text-caption leading-[1.7] text-[#f3f4f6]">
              {ENV_TEMPLATE}
            </pre>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-[#262727] py-2 pl-4 pr-2">
            <p className={`text-caption tabular-nums ${neon.muted}`}>
              {busy
                ? "Checking .env.local"
                : `${satisfiedCount} of ${required.length} found.`}
            </p>
            <button
              type="button"
              onClick={recheck}
              disabled={busy}
              aria-busy={busy}
              className={`flex min-h-[32px] items-center gap-1.5 rounded-full px-3 text-caption text-[#9ca3af] transition-colors duration-150 ease-out hover:bg-[#1a1b1b] hover:text-foreground disabled:opacity-60 ${neon.focusRing}`}
            >
              <RotateCw
                aria-hidden
                className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`}
              />
              <span className="grid text-center">
                <span aria-hidden className="col-start-1 row-start-1 invisible">
                  Checking…
                </span>
                <span className="col-start-1 row-start-1">
                  {busy ? "Checking…" : "Re-check"}
                </span>
              </span>
            </button>
          </div>

          <div
            aria-busy={busy}
            className={`divide-y divide-[#262727] border-t border-[#262727] transition-opacity duration-150 ease-out ${
              busy ? "opacity-60" : "opacity-100"
            }`}
          >
            {requirements.map((r) => (
              <RequirementRow key={r.id} requirement={r} />
            ))}
          </div>

        </Card>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <a
            href="https://console.neon.tech/app/settings/api-keys"
            target="_blank"
            rel="noreferrer"
            className={`inline-flex items-center gap-2 rounded-full bg-white px-[18px] py-2 text-ui font-medium text-[#0c0d0d] transition-[scale,background-color] duration-150 ease-out hover:bg-[#f3f4f6] active:scale-[0.96] ${neon.focusRing}`}
          >
            Generate a Neon API key
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <Button size="lg" variant="ghost" onClick={skip}>
            Explore without connecting
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>

        <p className="mt-5 flex max-w-[65ch] items-start gap-2 text-caption leading-[1.6] text-[#9ca3af]">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#00e599]" />
          <span className="text-pretty">
            <code className="font-mono">.env.local</code> is gitignored and
            never reaches the browser. Hosted, this setup screen will be
            replaced by OAuth; customer credentials and assessment results are
            not persisted by the app.
          </span>
        </p>
      </div>
    </div>
  );
}

function RequirementRow({ requirement }: { requirement: Requirement }) {
  const { label, envVar, detail, satisfied, invalid, optional } = requirement;

  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <span
        aria-hidden
        className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors duration-150 ease-out ${
          invalid
            ? "border-[#ef4444] bg-[#ef4444] text-[#0c0d0d]"
            : satisfied
              ? "border-[#00e599] bg-[#00e599] text-[#0c0d0d]"
              : "border-[#9ca3af]/35 text-transparent"
        }`}
      >
        {invalid ? (
          <X className="h-3 w-3" strokeWidth={2.5} />
        ) : (
          <Check className="h-3 w-3" strokeWidth={2.5} />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <code
            className={`break-words font-mono text-caption ${
              satisfied ? "text-foreground" : "text-[#f3f4f6]"
            }`}
          >
            {envVar}
          </code>
          <span className={`text-caption ${neon.muted}`}>{label}</span>
          {optional && (
            <span className="rounded-[4px] border border-[#262727] px-1.5 py-px text-micro text-[#9ca3af]">
              optional
            </span>
          )}
        </div>
        {invalid ? (
          <p className="mt-0.5 text-pretty text-caption leading-[1.5] text-[#ef4444]">
            {invalid}
          </p>
        ) : satisfied ? null : (
          <p className={`mt-0.5 text-pretty text-caption leading-[1.5] ${neon.muted}`}>
            {detail}
          </p>
        )}
      </div>
    </div>
  );
}
