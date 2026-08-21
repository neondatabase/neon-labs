// PoC v2: model Neon billed compute as the INTEGRAL of a utilization time-series
// — how Neon actually bills (CU-seconds over time) — instead of the crude
// avgCu × activeHours. A coarse hourly CPU% profile → per-hour CU → sum. This
// folds avgCu + activeHours + burstiness into one grounded number and captures
// scale-to-zero for free (hours near 0% → suspended → billed nothing).
//
// For use cases A/C this profile is MEASURED exactly (Neon's compute_unit_seconds
// buckets); for B it's approximated from the source platform's CPU metrics.

const MIN_ACTIVE_CU = 0.25; // Neon's floor while active
const IDLE_CPU_PCT = 1; // below this for the hour, treat as suspended (scale to zero)

/**
 * Integrate an hourly CPU% series into Neon billed compute.
 * @param {number[]} hourlyCpuPct one entry per hour of the billing period
 * @param {object} inst  { vcpu, maxCu }  — the source instance's vCPU + a max CU ceiling
 */
export function profileToCompute(hourlyCpuPct, { vcpu, maxCu = 16 }) {
  let billedCuHours = 0;
  let activeHours = 0;
  for (const pct of hourlyCpuPct) {
    if (pct < IDLE_CPU_PCT) continue; // suspended this hour → 0 CU
    // Instantaneous CU Neon would autoscale to: CPU-driven, clamped to [min, max].
    const cu = Math.min(Math.max((pct / 100) * vcpu, MIN_ACTIVE_CU), maxCu);
    billedCuHours += cu; // × 1 hour
    activeHours += 1;
  }
  return {
    billedCuHours: round(billedCuHours, 2),
    activeHours,
    avgActiveCu: activeHours ? round(billedCuHours / activeHours, 3) : 0,
    idleHours: hourlyCpuPct.length - activeHours,
  };
}

/**
 * Build a ~monthly hourly profile (744 h) from a representative day shape.
 * @param {number[]} weekday 24 hourly CPU% values for a weekday
 * @param {number[]} weekend 24 hourly CPU% values for a weekend day
 */
export function monthlyFromDayShapes(weekday, weekend, { weekdays = 22, weekendDays = 9 } = {}) {
  const out = [];
  for (let d = 0; d < weekdays; d++) out.push(...weekday);
  for (let d = 0; d < weekendDays; d++) out.push(...weekend);
  return out; // ~744 hours
}

// Convenience shapes for the demo.
export const flat = (pct) => Array(24).fill(pct);
export const businessHours = (busyPct, offPct = 0, from = 9, to = 18) =>
  Array.from({ length: 24 }, (_, h) => (h >= from && h < to ? busyPct : offPct));

function round(n, dp) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
