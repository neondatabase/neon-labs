// The two MVP analyses an agent calls (via api.mjs). Both return plain,
// JSON-serializable objects. All Neon numbers come from neon-pricing-core.

import { estimate, fitsFree, planUpgradeDiff, GB_PER_CU } from "./pricing-core/index.mjs";
import { estimateNeon } from "./estimate.mjs";
import { narrate } from "./narrate.mjs";
import { profileToCompute } from "./compute-profile.mjs";
import { snapshotToUsage } from "./usage-adapter.mjs";
import { supabaseToWorkload } from "./extract-supabase.mjs";
import { compareToNeon } from "./compare.mjs";

const WORKLOAD_FIELDS = ["peakCu", "avgCu", "activeHours", "storageGb", "egressGb"];

// Validate + normalize a workload before pricing, so bad input yields a clear
// 400 instead of a cryptic "Cannot read properties of undefined (reading 'value')".
// Accepts each field as {value, confidence, source} OR a bare number (agent-friendly).
export function normalizeWorkload(input) {
  if (!input || typeof input !== "object") {
    throw new Error(`workload must be an object with fields: ${WORKLOAD_FIELDS.join(", ")}`);
  }
  const out = {};
  const bad = [];
  for (const k of WORKLOAD_FIELDS) {
    const f = input[k];
    const value = f && typeof f === "object" ? f.value : f;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      bad.push(k);
      continue;
    }
    out[k] =
      f && typeof f === "object"
        ? { value, confidence: f.confidence ?? "user", source: f.source ?? "user" }
        : { value, confidence: "user", source: "user" };
  }
  if (bad.length) {
    throw new Error(
      `workload has missing/invalid field(s): ${bad.join(", ")}. Each must be a non-negative number ` +
        `(or {value,confidence,source}). To have them inferred instead, POST {supabase:{…}}.`,
    );
  }
  return out;
}

const HOURS_PER_MONTH = 744;

const trim = (est) => ({
  plan: est.plan,
  monthlyTotal: est.monthlyTotal.display,
  amount: est.monthlyTotal.amount,
  lines: est.lines
    .filter((l) => l.amount && l.amount.amount > 0)
    .map((l) => ({ label: l.label, amount: l.amount.display })),
});

// The ENTIRE Neon cost advantage is autoscaling + scale-to-zero: billing average CU
// over active hours instead of provisioned peak × 744 h. Every workload estimate
// PRESUPPOSES autoscaling is enabled — a fixed-size Neon compute bills like any
// provisioned instance and offers no saving. So we (1) state that premise, and (2)
// show the fixed-compute baseline so the autoscaling saving is explicit, not implied.
const AUTOSCALING_ASSUMPTION =
  "Assumes Neon AUTOSCALING is enabled (compute scales within a min↔max CU range with demand) and " +
  "SCALE-TO-ZERO is on (compute suspends after ~5 min idle, billing $0 until the next query). This is " +
  "the whole source of the saving: Neon bills average CU over active hours, not provisioned peak × " +
  "744 h. A fixed-size Neon compute bills like a provisioned instance — no autoscaling advantage.";

// Neon cost of running a FIXED compute at peak, 24/7 (no autoscaling, no scale-to-zero)
// — the provisioned-equivalent baseline. The gap vs the estimate IS the autoscaling win.
function withoutAutoscaling(w) {
  const usage = {
    compute: String(round2(w.peakCu.value * HOURS_PER_MONTH)),
    storage: String(w.storageGb.value),
    egress: String(w.egressGb.value),
  };
  return {
    launch: trim(estimate("launch", usage)),
    note: "Fixed Neon compute at peak, 24/7 (autoscaling + scale-to-zero OFF). The difference between this and the estimate above is precisely the autoscaling + scale-to-zero saving; with a fixed instance Neon has no cost edge over a provisioned DB.",
  };
}

/**
 * (a) Use case C — "I'm on Free; given this period's real usage, what would
 * Launch cost, and what do I gain?" Real usage in, so compute is MEASURED
 * (Neon's compute_unit_seconds → CU-hours); optionally integrate a utilization
 * profile instead. No inference / ranges here — this is the precise path.
 *
 * @param {object} u
 * @param {number} [u.cuHours]     measured CU-hours this period
 * @param {number[]} [u.profile]   hourly CPU% series (alternative to cuHours)
 * @param {{vcpu:number,maxCu?:number}} [u.instance] required with profile
 * @param {number} [u.storageGb]
 * @param {number} [u.egressGb]
 * @param {number} [u.peakCu]      optional; only affects the Free-fit capacity check
 */
export function analyzeFreeToLaunch(u = {}) {
  let cuHours = u.cuHours;
  let profileInfo = null;
  if (u.profile && u.instance) {
    profileInfo = profileToCompute(u.profile, u.instance);
    cuHours = profileInfo.billedCuHours;
  }
  if (cuHours == null)
    throw new Error(
      "provide real Neon usage: cuHours (a number — may be 0), a {snapshot} (neon-usage current_period_snapshot), or {profile:[hourly CPU%], instance:{vcpu}}.",
    );
  const storageGb = u.storageGb ?? 0;
  const egressGb = u.egressGb ?? 0;

  const usage = { compute: String(cuHours), storage: String(storageGb), egress: String(egressGb) };
  const peakCu = u.peakCu ?? 0.25;
  const onFree = fitsFree({
    compute: cuHours,
    storage: storageGb,
    egress: egressGb,
    peakVcpu: peakCu,
    peakRamGb: peakCu * GB_PER_CU,
  });

  const launch = estimate("launch", usage);
  const scale = estimate("scale", usage);
  const benefitsGained = planUpgradeDiff("free", "launch").map((g) => g.label);

  const summary =
    `This period on Free: ${cuHours} CU-hr, ${storageGb} GB storage, ${egressGb} GB egress` +
    (onFree.fits
      ? " — still within Free."
      : ` — over Free on: ${onFree.limiting.join(", ")}.`) +
    ` On Launch ≈ ${launch.monthlyTotal.display}/mo (Scale ≈ ${scale.monthlyTotal.display}/mo).` +
    ` Moving to Launch you gain: ${benefitsGained.slice(0, 5).join(", ")}.`;

  return {
    useCase: "C: Neon Free → Launch",
    onFree: { fits: onFree.fits, limiting: onFree.limiting },
    launch: trim(launch),
    scale: trim(scale),
    benefitsGained,
    ...(profileInfo ? { computeProfile: profileInfo } : {}),
    summary,
  };
}

/**
 * (a) real: run the Free→Launch analysis from a neon-usage current_period_snapshot
 * (actual Neon consumption). Aggregate (org-wide) plus per-project. This is the
 * MVP (a) path wired to real data — compute is measured, no inference.
 */
export function analyzeFromSnapshot(snapshot) {
  const { period, projects, total } = snapshotToUsage(snapshot);
  // PAID cost is PER-PROJECT: Launch/Scale egress allowance (500 GB) is per project,
  // so price each project separately and SUM (aggregating first would credit 500 GB
  // only once instead of once per project).
  const perProject = projects.map((p) => {
    const usage = { compute: String(p.cuHours), storage: String(p.storageGb), egress: String(p.egressGb) };
    return { projectId: p.projectId, launch: trim(estimate("launch", usage)), scale: trim(estimate("scale", usage)) };
  });
  const sumAmt = (plan) => round2(perProject.reduce((t, r) => t + r[plan].amount, 0));
  const cost = (amount) => ({ monthlyTotal: amount.toFixed(2), amount });
  // FREE-tier fit is ORG-LEVEL: Free's allowances (e.g. 5 GB egress) are per-org, so
  // check the AGGREGATE org usage once, not per project.
  const onFree = fitsFree({
    compute: total.cuHours,
    storage: total.storageGb,
    egress: total.egressGb,
    peakVcpu: 0.25,
    peakRamGb: 0.25 * GB_PER_CU,
  });
  return {
    useCase: "C: Neon Free → Launch (from real usage)",
    period,
    total: {
      usage: total,
      onFree: { fits: onFree.fits, limiting: onFree.limiting },
      launch: cost(sumAmt("launch")),
      scale: cost(sumAmt("scale")),
      benefitsGained: planUpgradeDiff("free", "launch").map((g) => g.label),
      note: "Free allowances (e.g. 5 GB egress) are per-ORG; paid egress (500 GB) is per-PROJECT, so paid totals sum per-project costs.",
    },
    projects: perProject,
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * (b) Use case B — "I'm not on Neon; if my workload looks like {this}, what do I
 * pay?" Takes an extracted workload schema (fields with value/confidence/source);
 * inferred inputs → the estimator returns ranges + top movers + a why-Neon
 * narrative. The Supabase data-gathering that produces the schema is deferred
 * (agent uses Supabase tooling); this API accepts the schema the agent builds.
 */
export function analyzeWorkload(workloadInput) {
  const workload = normalizeWorkload(workloadInput);
  const est = estimateNeon(workload);
  const story = narrate(workload, est);

  // Lead with the RIGHT headline: if the workload fits Free, the answer is $0 —
  // don't let a caller quote the paid Launch price for a workload that needs no
  // paid plan (that mistake happened with a tiny/idle DB reading $2.97).
  const recommendation = est.free.fits
    ? {
        plan: "free",
        monthlyTotal: "0.00",
        note: "Fits Neon's Free tier — no paid plan required for this workload. The Launch/Scale figures below are only what you'd pay if you move up for their FEATURES, not because usage demands it.",
      }
    : {
        plan: "launch",
        monthlyTotal: est.point.launch.monthlyTotal.display,
        note: `Over Free on: ${est.free.limiting.join(", ")}. Launch is the entry paid plan.`,
      };

  return {
    useCase: "B: workload → Neon",
    recommendation,
    assumptions: [AUTOSCALING_ASSUMPTION],
    launch: trim(est.point.launch),
    scale: trim(est.point.scale),
    range: est.range,
    withoutAutoscaling: withoutAutoscaling(workload),
    topMovers: est.topMovers,
    onFree: { fits: est.free.fits, limiting: est.free.limiting },
    why: story.wins,
    caveats: story.caveats,
  };
}

/**
 * (b) real-input path: raw Supabase signals → the workload schema (mapping done
 * HERE in code, not in agent prose) → estimate. Returns the extracted workload
 * (value/confidence/source) + extraction notes so the agent can show its work
 * and confirm the soft inputs.
 */
export function analyzeSupabase(signals = {}) {
  const { workload, notes } = supabaseToWorkload(signals);
  const analysis = analyzeWorkload(workload);
  return {
    ...analysis,
    source: "supabase",
    extractedWorkload: workload,
    extractionNotes: notes,
    // Head-to-head: the user's fixed Supabase instance (24/7) vs the derived Neon
    // workload (autoscaled) + a Neon-vs-Supabase feature summary. The comparator is
    // vendor-generic; this Supabase-extraction path names the competitor.
    comparison: compareToNeon("supabase", signals, analysis),
  };
}
