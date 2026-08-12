import { NeonWordmark } from "./NeonLogo";

export function AppFooter() {
  return (
    <footer className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-8 py-3">
      <span className="text-micro uppercase tracking-[0.08em] text-muted-foreground">
        Built on
      </span>
      <a
        href="https://neon.com"
        target="_blank"
        rel="noreferrer"
        aria-label="Neon, Serverless Postgres"
        className="inline-block rounded-[2px] transition-opacity duration-150 ease-out hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <NeonWordmark className="h-[14px] w-auto text-foreground" />
      </a>
      <span className="text-border">·</span>
      <span className="text-micro text-muted-foreground">
        Neon is part of the Databricks Platform
      </span>
    </footer>
  );
}
