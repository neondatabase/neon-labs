import type { PgMajorVersion } from "@/lib/types";
import { ArrowRight } from "lucide-react";

export function VersionTag({
  v,
  tone = "default",
}: {
  v: PgMajorVersion;
  tone?: "default" | "accent";
}) {
  const styles =
    tone === "accent"
      ? "border-[#00e599]/40 bg-[#00e599]/[0.06] text-[#00e599]"
      : "border-[#262727] bg-[#131414] text-[#f3f4f6]";
  return (
    <span
      className={`inline-flex items-center rounded-[4px] border px-1.5 py-0.5 font-mono text-label tnum ${styles}`}
    >
      PG {v}
    </span>
  );
}

export function VersionPath({
  source,
  target,
}: {
  source: PgMajorVersion;
  target: PgMajorVersion;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <VersionTag v={source} />
      <ArrowRight className="h-3 w-3 text-[#9ca3af]" />
      <VersionTag v={target} tone="accent" />
    </span>
  );
}
