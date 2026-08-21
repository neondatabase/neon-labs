// PoC: the factual "why Neon" narrative. GUARDRAIL — every line ties to a number
// from the estimate or the workload; it names which Neon mechanism wins (and by
// how much), shows the uncertainty, and calls out when Neon is NOT clearly
// cheaper. Credibility > persuasion.

const HOURS = 744;

// A few Neon plan features worth surfacing for "what you gain" (use case C / B).
// In the real product these come from neon-pricing-core's Neon plan-feature data;
// hard-coded here only for the spike.
const LAUNCH_GAINS_FROM_FREE = [
  "7-day point-in-time restore (Free has none)",
  "10 branches per project",
  "higher compute ceiling (autoscale beyond Free's 2 CU / 100 CU-hr)",
  "email support",
];

/** @returns {{ wins: string[], caveats: string[], gainsFromFree: string[] }} */
export function narrate(w, est) {
  const wins = [];
  const caveats = [];

  const peak = w.peakCu.value;
  const avg = w.avgCu.value;
  const hours = w.activeHours.value;
  const launch = est.point.launch;

  // Which line dominates the Launch bill? (factual anchor)
  const lines = launch.lines
    .filter((l) => l.amount && l.amount.amount > 0)
    .sort((a, b) => b.amount.amount - a.amount.amount);
  const total = launch.monthlyTotal.amount;
  if (lines.length && total > 0) {
    const top = lines[0];
    wins.push(
      `Estimated Launch: ${launch.monthlyTotal.display}/mo (range ${est.range.lo.toFixed(2)}–${est.range.hi.toFixed(2)}). ` +
        `Biggest line: ${top.label} ${top.amount.display} (${Math.round((top.amount.amount / total) * 100)}%).`,
    );
  }

  // Autoscaling win: over-provisioned but always-on. You'd pay for the peak on a
  // fixed instance; Neon bills the average.
  if (peak > 0 && avg / peak < 0.8) {
    const savedPct = Math.round((1 - avg / peak) * 100);
    wins.push(
      `Autoscaling: you provisioned ~${peak} CU but average ~${avg} CU — Neon bills the average, ` +
        `so you avoid paying for ~${savedPct}% of headroom a fixed instance charges 24/7.`,
    );
  }

  // Scale-to-zero win: idle hours. Neon bills only active hours.
  if (hours < HOURS * 0.95) {
    const idlePct = Math.round((1 - hours / HOURS) * 100);
    wins.push(
      `Scale-to-zero: active ~${hours} h/mo (~${idlePct}% idle). Neon suspends idle compute and bills ` +
        `only the active hours; a fixed instance bills all ${HOURS} h.`,
    );
  } else {
    caveats.push(
      `Always-on assumed (${hours} h) — no scale-to-zero credit applied. If the DB is actually idle ` +
        `part of the month, Neon would be cheaper than shown; confirm the activity pattern.`,
    );
  }

  // Egress headroom (Launch includes 500 GB).
  const egress = w.egressGb.value;
  if (egress <= 500) {
    wins.push(`Egress: ~${egress} GB/mo is within Launch's 500 GB allowance → $0.`);
  } else {
    wins.push(`Egress: ~${egress} GB/mo → ${egress - 500} GB billable at $0.10/GB.`);
  }

  // GUARDRAIL — when is Neon NOT clearly cheaper? Steady, high-utilization,
  // always-on workloads give up Neon's two main levers.
  if (avg / (peak || 1) >= 0.8 && hours >= HOURS * 0.95) {
    caveats.push(
      "This workload is steady + always-on (high utilization, no idle) — Neon's autoscaling and " +
        "scale-to-zero advantages mostly don't apply here; compare on storage/egress + features, not just compute.",
    );
  }

  // Uncertainty honesty.
  if (est.topMovers.length) {
    const m = est.topMovers.map((x) => `${x.field} (${x.confidence})`).join(", ");
    caveats.push(`Numbers swing most on: ${m}. Confirm these to tighten the estimate.`);
  }

  // Free-fit note (bridges toward use case C framing).
  if (est.free?.fits) {
    caveats.push("This workload actually fits Neon's Free tier — you may not need a paid plan yet.");
  }

  return { wins, caveats, gainsFromFree: LAUNCH_GAINS_FROM_FREE };
}
