"use client";

import { useState, type ReactNode } from "react";
import { Check, X, Minus } from "lucide-react";
import { neon } from "@/components/ui";
import { Card, CardHeader } from "@/components/ui/card";

// Thin client shell around two SERVER-rendered matrix tables (passed as props, so both
// are in the HTML and work without JS). The toggle just flips which is visible via CSS
// — no reload, no refetch. Default (and no-JS) shows paid.
export function CapabilityMatrix({ paid, free, dimensions }: { paid: ReactNode; free: ReactNode; dimensions: number }) {
  const [freeTier, setFreeTier] = useState(false);
  return (
    <Card className="flex flex-col gap-0">
      <CardHeader className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className={neon.h2}>Neon vs Supabase — capabilities</h2>
            <p className={`mt-1 text-caption ${neon.muted}`}>
              {freeTier ? "Free tier" : "Paid tiers"}, {dimensions} dimensions.{" "}
              <Check className="mb-0.5 inline h-3 w-3 text-primary" aria-hidden /> offered ·{" "}
              <Minus className="mb-0.5 inline h-3 w-3 text-amber-500" aria-hidden /> partial ·{" "}
              <X className="mb-0.5 inline h-3 w-3 text-muted-foreground/60" aria-hidden /> not offered.
            </p>
          </div>
          <div className="flex shrink-0 rounded-[5px] border border-border p-0.5 text-caption" role="group" aria-label="Plan tier">
            {[
              { label: "Paid tiers", free: false },
              { label: "Free tier", free: true },
            ].map((t) => (
              <button
                key={t.label}
                type="button"
                onClick={() => setFreeTier(t.free)}
                aria-pressed={freeTier === t.free}
                className={`rounded-[3px] px-2.5 py-1 transition-colors ${freeTier === t.free ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <div className={freeTier ? "hidden" : undefined}>{paid}</div>
      <div className={freeTier ? undefined : "hidden"}>{free}</div>
    </Card>
  );
}
