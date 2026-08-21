import { headers } from "next/headers";
import { PageHeader, neon } from "@/components/ui";
import { Card, CardHeader } from "@/components/ui/card";
import { featuresFor } from "@/lib/compare/compare.mjs";
import { rateCard } from "@/lib/compare/pricing-core/index.mjs";
import { buildRateTable } from "./tables.mjs";
import { AgentLauncher } from "./AgentLauncher";
import { MatrixTable, type Matrix } from "./MatrixTable";
import { CapabilityMatrix } from "./CapabilityMatrix";

// Dynamic route: it depends on the request host (for absolute agent URLs), so it renders
// per request. The comparison DATA is deterministic — the same numbers/logic power the
// agent API at /api/compare/*. Table shaping is in ./tables.mjs (unit-tested); the
// capability matrix + its client-side Paid/Free toggle live in ./CapabilityMatrix.

type VendorCard = { vendor: string; label: string; sources: string[] };
type RateTable = { columns: { vendorLabel: string; planLabel: string }[]; rows: { label: string; cells: { value: string; sub: string | null }[] }[] };

// Hostname for a source link, defensively (a malformed URL must not 500 the page).
const hostLabel = (s: string) => {
  try {
    return new URL(s).hostname.replace("www.", "");
  } catch {
    return s;
  }
};

export default async function ComparePage() {
  // Both tiers precomputed so the matrix's Paid/Free toggle switches client-side.
  const paidMatrix = featuresFor() as unknown as Matrix;
  const freeMatrix = featuresFor(undefined, undefined, "free") as unknown as Matrix;
  const rawCards = rateCard();
  const rateTable = buildRateTable(rawCards) as unknown as RateTable;
  const cards = rawCards as unknown as VendorCard[]; // for the sources footer

  // Prefer a configured canonical origin so the pasteable agent prompt / copied URLs
  // aren't built from an untrusted Host header in production; fall back to the header
  // for local dev.
  const h = await headers();
  const host = h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const origin = process.env.NEXT_PUBLIC_SITE_ORIGIN || (host ? `${proto}://${host}` : "");

  return (
    <div className={neon.page}>
      <div className={`${neon.pageContent} flex flex-col gap-5`}>
        <PageHeader
          title="Cost & features"
          subtitle="Ask your coding agent to size up your current database and estimate it on Neon — read-only, no manual entry. Reference data below."
        />

        <AgentLauncher origin={origin} />

        <div className="mt-1">
          <h2 className={neon.h2}>For reference</h2>
          <p className={`mt-0.5 text-caption ${neon.muted}`}>The capability matrix and rates the estimate is built from — the agent uses the same data.</p>
        </div>

        <CapabilityMatrix
          dimensions={paidMatrix.dimensions.length}
          paid={<MatrixTable matrix={paidMatrix} />}
          free={<MatrixTable matrix={freeMatrix} />}
        />

        {/* Rates — the paid tiers (free tiers are $0, usage-capped). */}
        <Card className="flex flex-col gap-0">
          <CardHeader className="border-b border-border px-5 py-4">
            <h2 className={neon.h2}>Rates</h2>
            <p className={`mt-1 text-caption ${neon.muted}`}>
              Paid tiers, per unit. Neon bills usage (autoscaling); Supabase bills a fixed instance. Estimates — see sources.
            </p>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-caption">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="w-[130px] px-5 py-2.5 text-left font-medium text-muted-foreground">Rate</th>
                  {rateTable.columns.map((c) => (
                    <th scope="col" key={`${c.vendorLabel}-${c.planLabel}`} className="px-4 py-2.5 text-left font-medium text-foreground">
                      {c.vendorLabel} {c.planLabel}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rateTable.rows.map((row) => (
                  <tr key={row.label} className="border-b border-border/50 transition-colors hover:bg-muted/30">
                    <th scope="row" className="px-5 py-2.5 text-left font-medium text-foreground">{row.label}</th>
                    {row.cells.map((cell, i) => (
                      <td key={i} className="px-4 py-2.5">
                        <span className="font-mono tnum text-foreground">{cell.value}</span>
                        {cell.sub && <span className="mt-0.5 block text-[11px] text-muted-foreground">{cell.sub}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
            <span>Sources:</span>
            {cards.map((v) => (
              <span key={v.vendor} className="flex items-center gap-1.5">
                <span className="text-foreground">{v.label}</span>
                {v.sources.map((s) => (
                  <a key={s} href={s} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                    {hostLabel(s)}
                  </a>
                ))}
              </span>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
