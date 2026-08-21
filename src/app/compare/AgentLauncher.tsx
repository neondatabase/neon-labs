import { Bot, ShieldCheck, Sparkles } from "lucide-react";
import { neon } from "@/components/ui";
import { Card, CardHeader } from "@/components/ui/card";
import { ApiConsole, CopyButton } from "./interactive";

// The prompt embeds an ABSOLUTE guide URL (origin resolved server-side from the
// request host) so it's pasteable into any agent, in any project.
const buildPrompt = (origin: string) =>
  `Figure out my current database's setup and usage, then estimate what it would cost on Neon and how the features compare.\n\n` +
  `Read this playbook and follow it end-to-end: ${origin}/api/compare/guide\n\n` +
  `Keep everything read-only. Only send aggregate numbers (sizes, CPU %, active hours, egress) — never credentials, connection strings, or data — and show me the exact request before sending anything.`;

// Server component: the tool is agent-first — a human doesn't fill sliders, they ask
// their coding agent to read their stack read-only and price it on Neon. Structure and
// the endpoint list are server-rendered; only the copy/paste bits are client islands.

const ENDPOINTS: { method: string; path: string; desc: string }[] = [
  { method: "GET", path: "/api/compare/guide", desc: "The playbook — an agent fetches this and follows it end-to-end. Start here." },
  { method: "POST", path: "/api/compare/estimate", desc: "Price a workload, a Supabase instance, or a known plan. Routes on the payload shape." },
  { method: "GET", path: "/api/compare/pricing", desc: "Machine-readable rate card (rates, instance grids, sources)." },
  { method: "GET", path: "/api/compare/features", desc: "Capability matrix (Neon vs Supabase; ?vendor=neon for the plan ladder, ?tier=free for free-vs-free)." },
  { method: "GET", path: "/api/compare/openapi.json", desc: "OpenAPI 3.1 contract for tooling / codegen." },
];

export function AgentLauncher({ origin }: { origin: string }) {
  const prompt = buildPrompt(origin);
  return (
    <>
      {/* Ask your agent */}
      <Card className="flex flex-col gap-0">
        <CardHeader className="border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <h2 className={neon.h2}>Ask your agent to price your migration</h2>
          </div>
          <p className={`mt-1 text-caption ${neon.muted}`}>
            You don&apos;t fill in sliders. Point your coding agent (Claude Code, Cursor, …) at your project —
            it inspects your current database <span className="text-foreground">read-only</span>, maps the
            workload, and returns a Neon cost estimate, a head-to-head comparison, and a migration plan.
          </p>
        </CardHeader>
        <div className="px-5 py-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-caption font-medium text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Paste this to your agent
            </span>
            <CopyButton text={prompt} label="Copy prompt" />
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-[6px] border border-border bg-muted/40 px-4 py-3 text-[12px] leading-relaxed text-foreground">{prompt}</pre>
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
            Runs read-only and sends only aggregate numbers — it shows you the exact request before anything leaves your machine. Prefer to send nothing? The playbook also gives the formulas to compute it locally.
          </p>
        </div>
      </Card>

      {/* The API */}
      <Card className="flex flex-col gap-0">
        <CardHeader className="border-b border-border px-5 py-4">
          <h2 className={neon.h2}>The API</h2>
          <p className={`mt-1 text-caption ${neon.muted}`}>
            Same origin as this page. An agent given just the guide URL can do the rest; these are the direct endpoints.
          </p>
        </CardHeader>
        <ApiConsole endpoints={ENDPOINTS} origin={origin} />
      </Card>
    </>
  );
}
