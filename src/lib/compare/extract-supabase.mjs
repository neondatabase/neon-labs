// PoC: map the signals an agent can gather from a Supabase project into the
// normalized WORKLOAD SCHEMA — each field carrying { value, confidence, source }
// so downstream (estimate + narrative) knows what's solid vs a guess.
//
// This is the spike for use case (B): "if my workload looks like {this}, what do
// I pay on Neon?" The whole product bet is that this mapping is accurate enough.
// Every mapping below is commented with its basis + why the confidence level —
// FINDINGS.md summarizes what held vs what needs a range or a question.

// confidence: how much to trust the value. source: where it came from.
//   high     — measured directly (a real metric/query result)
//   medium   — a defensible derivation from a measured signal
//   low       — an inference with wide error bars
//   assumed   — a fallback default the user didn't provide
export const CONFIDENCE = /** @type {const} */ (["high", "medium", "low", "assumed"]);

function field(value, confidence, source, basis) {
  return { value, confidence, source, basis };
}

// Supabase compute add-on sizes (vCPU / RAM GB). Approximate, from Supabase's
// compute add-on docs; flagged as an assumption in any output that uses them.
// (A real agent would read the project's actual instance size from the API.)
// Validated Dec 2025/2026 against supabase.com/docs/guides/platform/compute-and-disk.
// Nano–Medium are shared/burstable ("2 cores" is a burst ceiling, not sustained vCPU),
// so avgCu on those tiers should key off MEASURED CPU%, not nominal vCPU. Large+ dedicated.
const SUPABASE_INSTANCES = {
  nano: { vcpu: 0.5, ramGb: 0.5, shared: true },
  micro: { vcpu: 2, ramGb: 1, shared: true },
  small: { vcpu: 2, ramGb: 2, shared: true },
  medium: { vcpu: 2, ramGb: 4, shared: true },
  large: { vcpu: 2, ramGb: 8 },
  xl: { vcpu: 4, ramGb: 16 },
  "2xl": { vcpu: 8, ramGb: 32 },
  "4xl": { vcpu: 16, ramGb: 64 },
  "8xl": { vcpu: 32, ramGb: 128 },
  "12xl": { vcpu: 48, ramGb: 192 },
  "16xl": { vcpu: 64, ramGb: 256 },
};

/** Known Supabase compute add-on keys (for the API catalog / agent guidance). */
export const SUPABASE_INSTANCE_KEYS = Object.keys(SUPABASE_INSTANCES);
export const ACTIVITY_PATTERNS = ["always_on", "business_hours", "intermittent", "unknown"];

const HOURS_PER_MONTH = 744;

/**
 * Map Supabase signals → workload schema.
 * @param {object} s signals an agent gathered
 * @param {string}  [s.instance]      compute add-on key (e.g. "large")
 * @param {number}  [s.dbSizeGb]      pg_database_size in GB (measured)
 * @param {number}  [s.avgCpuPct]     avg CPU utilization % over the period (metric)
 * @param {"always_on"|"business_hours"|"intermittent"|"unknown"} [s.activity] usage pattern
 * @param {number}  [s.egressGb]      monthly data transfer out in GB, if known
 */
export function supabaseToWorkload(s = {}) {
  const inst = s.instance ? SUPABASE_INSTANCES[s.instance] : undefined;
  const notes = [];
  if (s.instance && !inst) {
    notes.push(`unknown Supabase instance "${s.instance}" (known: ${SUPABASE_INSTANCE_KEYS.join(", ")}); peak assumed.`);
  }

  // ---- peakCu: instance capacity Neon must clear = max(vCPU, RAM/4) ----
  // A Neon CU is 1 vCPU + 4 GB, so covering a Supabase instance needs enough CU
  // for BOTH its vCPU and its RAM: small tiers are vCPU-bound (2 vCPU / little
  // RAM), larger tiers RAM-bound. Peak mostly sets the autoscaling ceiling — it
  // barely affects the (avg-driven) Launch bill. Cap at Neon's 16 CU autoscaling.
  // See docs/autoscaling-mapping.md.
  let peakCu;
  if (inst) {
    const byRam = inst.ramGb / 4;
    const cu = Math.min(Math.max(inst.vcpu, byRam), 16);
    peakCu = field(
      round(cu, 2),
      "medium",
      "inferred",
      `Supabase ${s.instance} = ${inst.vcpu} vCPU / ${inst.ramGb} GB → peak max(vCPU, RAM/4) = ${round(cu, 2)} CU`,
    );
    if (inst.shared) {
      notes.push(
        `Supabase ${s.instance} is shared/burstable CPU; mapping its ${inst.vcpu} vCPU 1:1 to CU may overstate sustained peak.`,
      );
    }
  } else {
    peakCu = field(1, "assumed", "default", "no instance size given; assumed 1 CU peak");
  }

  // ---- avgCu: the billed compute under autoscaling = vCPU × CPU% ----
  // Neon bills the AVERAGE CU (autoscaling win). CPU% is a vCPU measure, so avg
  // compute ≈ vCPU × avgCPU% (matches Neon's autoscaling report and our profile-
  // integral model), clamped to [0.25 min-active, peak]. THE pivotal input, so
  // it's marked low-confidence and the estimator ranges over it. A RAM-heavy
  // working set can raise this floor (see caveat). docs/autoscaling-mapping.md.
  let avgCu;
  const vcpu = inst?.vcpu ?? peakCu.value ?? 1;
  if (s.avgCpuPct != null) {
    const raw = vcpu * (s.avgCpuPct / 100);
    avgCu = field(
      round(Math.min(Math.max(raw, 0.25), peakCu.value ?? raw), 3),
      "low",
      "inferred",
      `${vcpu} vCPU × ${s.avgCpuPct}% avg CPU (CPU-driven; clamped to [0.25, peak])`,
    );
    notes.push(
      "avg CU is the biggest uncertainty (a single CPU% masks bursts); an hourly CPU profile is far more accurate. A large RAM working set can raise avg above the CPU-driven figure.",
    );
  } else {
    // No utilization given: Neon's default assumption, avg ≈ 50% of peak.
    avgCu = field(
      peakCu.value != null ? round(peakCu.value * 0.5, 3) : 0.5,
      "assumed",
      "default",
      "no CPU utilization given; assumed avg = 50% of peak",
    );
  }

  // ---- activeHours: the scale-to-zero signal ----
  // A Supabase instance is billed 24/7 regardless, but Neon scales to zero, so
  // the hours the DB is actually active drive the Neon bill. Detecting idle is
  // high-value and often low-confidence.
  const ACTIVITY_HOURS = {
    always_on: field(HOURS_PER_MONTH, "high", "inferred", "always-on production (744 h)"),
    business_hours: field(
      Math.round(12 * 22),
      "medium",
      "inferred",
      "~business hours (12 h × 22 days ≈ 264 h) — Neon scales to zero off-hours",
    ),
    intermittent: field(
      Math.round(HOURS_PER_MONTH * 0.15),
      "low",
      "inferred",
      "intermittent/dev DB (~15% of the month) — big scale-to-zero win, but the % is a guess",
    ),
  };
  const activeHours =
    ACTIVITY_HOURS[s.activity] ??
    field(HOURS_PER_MONTH, "assumed", "default", "activity pattern unknown; assumed always-on (no scale-to-zero credit)");

  // ---- storageGb: measured, the easy one ----
  const storageGb =
    s.dbSizeGb != null
      ? field(round(s.dbSizeGb, 2), "high", "measured", "pg_database_size")
      : field(1, "assumed", "default", "no DB size given; assumed 1 GB");

  // ---- egressGb: platform metric if present, else unknown ----
  const egressGb =
    s.egressGb != null
      ? field(round(s.egressGb, 1), "medium", "measured", "platform data-transfer metric")
      : field(0, "low", "assumed", "egress unknown; assumed 0 (likely understates — ask the user)");

  return {
    workload: { peakCu, avgCu, activeHours, storageGb, egressGb },
    notes,
  };
}

function round(n, dp) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
