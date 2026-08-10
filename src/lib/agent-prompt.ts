import type { AssessmentResult, DetectedChange } from "@/lib/types";

const STATUS_HEADING: Record<string, string> = {
  blocker: "Blockers, these stop the upgrade",
  warning: "Warnings, these need a decision",
  pass: "Already clear, verify the assumption still holds",
};

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function section(status: string, changes: DetectedChange[]) {
  const scoped = changes.filter((c) => c.status === status);
  if (scoped.length === 0) return "";
  const body = scoped
    .map((c) => {
      const lines = [
        `### ${c.title}`,
        `Introduced in PostgreSQL ${c.introducedIn}. Category: ${c.category}.`,
        c.description,
      ];
      if (c.detectedDetail) lines.push(`Detected in this database: ${c.detectedDetail}`);
      if (c.remediation) lines.push(`Suggested remediation: ${c.remediation}`);
      if (c.docsUrl) lines.push(`Reference: ${c.docsUrl}`);
      return lines.join("\n");
    })
    .join("\n\n");
  return `## ${STATUS_HEADING[status] ?? status}\n\n${body}`;
}

/** Builds a prompt the user can paste into a coding agent so it can act on the
    assessment against their actual codebase, which this app cannot see. */
export function buildAgentPrompt(
  assessment: AssessmentResult,
  changes: DetectedChange[],
): string {
  const { metadata, stats, sourceVersion, targetVersion } = assessment;
  const sections = ["blocker", "warning", "pass"]
    .map((status) => section(status, changes))
    .filter(Boolean)
    .join("\n\n");

  return `I am upgrading a PostgreSQL database from ${sourceVersion} to ${targetVersion} on Neon.

Database: ${metadata.database}, ${stats.totalSizeGb} GB, ${plural(stats.tables, "table")}, ${plural(stats.extensionCount, "extension")}.
Running: ${metadata.pgVersionFull}

An upgrade assessment produced the findings below. Work through them against this repository and the database schema. For each finding:

1. Decide whether it actually applies to this codebase, and say why.
2. If it applies, make the change or write the migration. If it does not, say so and move on.
3. Flag anything that needs a human decision rather than guessing.

Do not run destructive statements against production. Show me the plan before executing anything that writes.

${sections}`;
}
