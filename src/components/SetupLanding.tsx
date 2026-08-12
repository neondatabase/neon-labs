"use client";

import { ArrowRight, LogIn, ShieldCheck } from "lucide-react";
import type { SetupStatus } from "@/lib/setup-status";
import Image from "next/image";
import { PageBackground } from "./PageBackground";
import { neon } from "./ui";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

export function SetupLanding({ status }: { status: SetupStatus }) {
  const { env, skip } = status;
  const oauthConfigured = Boolean(env?.oauthConfigured);

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

        <Card className="mt-8 gap-0">
          <div className="p-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#00e599]/10 text-[#00e599]">
              <LogIn className="h-4 w-4" />
            </div>
            <h2 className={`${neon.h3} mt-4`}>Sign in with Neon</h2>
            <p className={`mt-1 max-w-[60ch] text-caption leading-[1.6] ${neon.muted}`}>
              Authorize this app to access projects in your Neon account. Every
              request uses your OAuth session; no shared organization API key
              is used.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-[#262727] p-4">
            {oauthConfigured ? (
              <a
                href="/api/auth/neon"
                className={`inline-flex min-h-9 items-center gap-2 rounded-full bg-white px-[18px] py-2 text-ui font-medium text-[#0c0d0d] transition-[scale,background-color] duration-150 ease-out hover:bg-[#f3f4f6] active:scale-[0.96] ${neon.focusRing}`}
              >
                Sign in with Neon
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            ) : (
              <Button size="lg" variant="white" disabled>
                Sign in with Neon
              </Button>
            )}
            <Button size="lg" variant="ghost" onClick={skip}>
              Explore without connecting
            </Button>
          </div>
          {!oauthConfigured && (
            <p className="border-t border-[#262727] px-4 py-3 text-caption text-[#f59e0b]">
              Neon OAuth is not configured for this deployment yet.
            </p>
          )}
        </Card>

        <p className="mt-5 flex max-w-[65ch] items-start gap-2 text-caption leading-[1.6] text-[#9ca3af]">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#00e599]" />
          <span className="text-pretty">
            Access and refresh tokens are encrypted in an HttpOnly session
            cookie. They are not exposed to browser JavaScript, written to a
            database, or shared between users.
          </span>
        </p>
      </div>
    </div>
  );
}
