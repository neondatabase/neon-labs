// PoC: take the confidence-annotated workload schema and price it on each Neon
// plan via the shared estimator core. Because the input carries confidence, we
// return a POINT estimate plus a RANGE (driven by the uncertain fields) and name
// the inputs that move the number most — instead of false precision.

import { estimate, fitsFree } from "./pricing-core/index.mjs";

const GB_PER_CU = 4;

// Multiplicative uncertainty band per confidence level. high = pinned.
const BAND = {
  high: [1, 1],
  medium: [0.8, 1.25],
  low: [0.5, 2],
  assumed: [0.5, 2],
};

// Workload schema (field.value) → core usage for a Neon plan estimate.
// Neon autoscales (bills avg CU) and scales to zero (bills only active hours),
// so billed compute = avgCu × activeHours CU-hours.
function usageFrom(w, { avgCu, activeHours, storageGb, egressGb } = {}) {
  const avg = avgCu ?? w.avgCu.value;
  const hours = activeHours ?? w.activeHours.value;
  return {
    compute: String(avg * hours),
    storage: String(storageGb ?? w.storageGb.value),
    egress: String(egressGb ?? w.egressGb.value),
  };
}

function planTotal(plan, w, overrides) {
  return estimate(plan, usageFrom(w, overrides)).monthlyTotal.amount;
}

/** Point estimate + range + free-fit + top movers for a workload schema. */
export function estimateNeon(w) {
  const plans = ["launch", "scale"];
  const point = Object.fromEntries(
    plans.map((p) => [p, estimate(p, usageFrom(w))]),
  );

  // Free-tier fit (uses capacity + budget). peakRamGb from the RAM-sized peak.
  const free = fitsFree({
    compute: Number(usageFrom(w).compute),
    storage: w.storageGb.value,
    egress: w.egressGb.value,
    peakVcpu: w.peakCu.value,
    peakRamGb: w.peakCu.value * GB_PER_CU,
  });

  // Range on the Launch total: widen every uncertain field to its band.
  const uncertain = ["avgCu", "activeHours", "storageGb", "egressGb"];
  const lo = {};
  const hi = {};
  for (const f of uncertain) {
    const [b0, b1] = BAND[w[f].confidence] ?? [1, 1];
    lo[f] = w[f].value * b0;
    hi[f] = w[f].value * b1;
  }
  const rangeLo = planTotal("launch", w, lo);
  const rangeHi = planTotal("launch", w, hi);

  // Top movers: how much each field alone swings the Launch total across its band.
  const movers = uncertain
    .map((f) => {
      const [b0, b1] = BAND[w[f].confidence] ?? [1, 1];
      const swing =
        planTotal("launch", w, { [f]: w[f].value * b1 }) -
        planTotal("launch", w, { [f]: w[f].value * b0 });
      return { field: f, swing: round(swing, 2), confidence: w[f].confidence };
    })
    .filter((m) => m.swing > 0.005)
    .sort((a, b) => b.swing - a.swing);

  return {
    point, // { launch: Estimate, scale: Estimate }
    free, // fitsFreeTier result
    range: { plan: "launch", lo: round(rangeLo, 2), hi: round(rangeHi, 2) },
    topMovers: movers.slice(0, 2),
  };
}

function round(n, dp) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
