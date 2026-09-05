import { Check, Copy } from "lucide-react";
import type { CheckStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";

/* ──────────────────────────────────────────────────────────────
   Shared Neon Console primitives
   ────────────────────────────────────────────────────────────── */

export const neon = {
  /* Layout */
  page: "px-8 py-6",
  pageContent: "mx-auto max-w-[1200px]",

  /* Typography helpers, Inter, brand-spec tracking */
  h1: "text-display-sm font-medium heading-tight text-foreground",
  h2: "text-heading font-medium heading-tight text-foreground",
  h3: "text-body font-medium text-foreground",
  body: "text-body leading-[1.5] text-[#f3f4f6]",
  muted: "text-[#9ca3af]",
  dim: "text-[#9ca3af]",
  mono: "font-mono text-caption tracking-[-0.36px] tabular-nums",

  focusRing:
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e599]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0d0d]",
  tag: "tag", // applied via globals.css
};

/* ── Status badge, small 4px chip, semantic colors ───────── */

export function StatusBadge({ status }: { status: CheckStatus | string }) {
  const styles: Record<string, string> = {
    pass: "bg-[#00e599]/10 text-[#00e599] border-[#00e599]/30",
    available: "bg-[#00e599]/10 text-[#00e599] border-[#00e599]/30",
    warning: "bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/30",
    under_review: "bg-[#4f9eed]/10 text-[#4f9eed] border-[#4f9eed]/30",
    planned: "bg-[#a78bfa]/10 text-[#a78bfa] border-[#a78bfa]/30",
    blocker: "bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/30",
    not_supported: "bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/30",
  };
  const labels: Record<string, string> = {
    pass: "Pass",
    available: "Available",
    warning: "Warning",
    under_review: "Under review",
    planned: "Planned",
    blocker: "Blocker",
    not_supported: "Not supported",
  };
  return (
    <Badge
      variant="outline"
      className={`text-label rounded-[4px] ${styles[status] ?? styles.warning}`}
    >
      {labels[status] ?? status}
    </Badge>
  );
}

/* ── Score ring ─────────────────────────────────────────── */

export function ScoreRing({ score }: { score: number }) {
  const color = score >= 80 ? "#00e599" : score >= 60 ? "#f59e0b" : "#ef4444";
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative inline-flex h-28 w-28 items-center justify-center">
      <svg className="h-28 w-28 -rotate-90" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="#262727"
          strokeWidth="6"
        />
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute text-center">
        <span className="text-display-sm text-foreground tnum leading-none font-medium tracking-[-0.5px]">
          {score}
        </span>
        <p className="text-micro mt-1 tracking-[0.08em] text-[#9ca3af] uppercase">
          / 100
        </p>
      </div>
    </div>
  );
}

/* ── Page header (title + subtitle, console style) ────────── */

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className={`${neon.h1} text-balance`}>{title}</h1>
        {subtitle ? (
          <p className="text-ui text-muted-foreground mt-1.5 max-w-[54ch] text-pretty">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  );
}

export { EmptyState } from "./empty-state/empty-state";
export type { EmptyStateProps } from "./empty-state/empty-state";

/* ── Select card, used in New Assessment ─────────────────── */

export function SelectCard({
  selected,
  onClick,
  children,
  disabled,
}: {
  selected: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <div className="cursor-not-allowed rounded-[4px] border border-[#262727]/60 bg-[#131414]/40 p-4 opacity-40">
        {children}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group rounded-[4px] border p-4 text-left transition-[scale,background-color,border-color] duration-150 ease-out active:scale-[0.96] ${neon.focusRing} ${
        selected
          ? "border-[#00e599]/50 bg-[#00e599]/[0.04]"
          : "border-[#262727] bg-[#131414] hover:border-[#262727] hover:bg-[#1a1b1b]"
      }`}
    >
      {children}
    </button>
  );
}

/* ── Copy toggle icon ───────────────────────────────────
   Both icons stay mounted and cross-fade, so the confirmation has an
   exit as well as an enter. No motion library in the project, so this
   is pure CSS. Sized to a fixed box to stop the label from shifting. */

export function CopyToggleIcon({
  copied,
  className = "h-3.5 w-3.5",
}: {
  copied: boolean;
  className?: string;
}) {
  const base =
    "absolute inset-0 transition-[opacity,scale,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)]";
  return (
    <span className={`relative inline-block shrink-0 ${className}`}>
      <Copy
        aria-hidden
        className={`${base} h-full w-full ${
          copied
            ? "scale-[0.25] opacity-0 blur-[4px]"
            : "blur-0 scale-100 opacity-100"
        }`}
      />
      <Check
        aria-hidden
        className={`${base} h-full w-full ${
          copied
            ? "blur-0 scale-100 opacity-100"
            : "scale-[0.25] opacity-0 blur-[4px]"
        }`}
      />
    </span>
  );
}

/* ── Breadcrumb, console-style with slash separators ─────── */

export function Breadcrumb({
  items,
}: {
  items: { label: string; href?: string }[];
}) {
  return (
    <nav className="text-ui flex items-center gap-2">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && <span className="text-[#262727]">/</span>}
          {item.href ? (
            <a
              href={item.href}
              className={`hover:text-foreground text-[#9ca3af] transition-colors duration-150 ease-out ${neon.focusRing} rounded-[2px]`}
            >
              {item.label}
            </a>
          ) : (
            <span className="text-foreground">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
