// Free-tier fit + "what it would cost if it doesn't fit". A free tier isn't a
// price — it's resource limits + a behavior on exceed (suspend / pause / expire
// / bill) + capability + durability. We emit raw, normalized fit facts per
// dimension (numbers/booleans, no wording) so a presentation layer can format
// fair comparisons; and when a workload overflows, we price the paid fallback.

import { compareWorkload } from "./compare.mjs";
import { deepFreeze } from "./util.mjs";
import { VENDORS } from "./vendors.mjs";

const HOURS_PER_MONTH = 744;
const GIB_FROM_GB = 1e9 / 2 ** 30; // decimal GB → binary GiB (≈0.9313)

// Whether a capacity ceiling (RAM/vCPU) gates the fit. vCPU is an EXACT
// comparison (1 CU = 1 vCPU), so a peak over the free tier's published cores
// fails immediately. RAM is a `peakCu × 4` proxy, so it only gates on a GROSS
// overshoot (several times the instance) to avoid flip-flopping on the estimate;
// a small RAM overshoot stays an informational capacityNote.
const GROSS_CAPACITY_FACTOR = 2;
const capacityGates = (f) => {
  if (f.category !== "capacity" || f.fits !== false || !(f.limit > 0)) return false;
  const factor = f.dimension === "compute.vcpu" ? 1 : GROSS_CAPACITY_FACTOR;
  return f.workload > f.limit * factor;
};
// Does a fact gate the headline fit? Consumption caps always; capacity per above.
const factGates = (f) => (f.category === "capacity" ? capacityGates(f) : f.fits === false);

/** How "free" a vendor's $0 offering really is. */
export const FREE_KIND_LABEL = deepFreeze({
  permanent: "permanent free",
  expiring_trial: "trial (expires)",
  converting_trial: "trial → paid",
  credit_trial: "trial credit",
  ongoing_credit: "usage credit",
  none: "none",
});

/** What each on-exceed / on-idle action means (they are NOT synonyms). */
export const EXCEED_GLOSSARY = deepFreeze({
  suspend: "compute auto-suspends (scale-to-zero) and auto-resumes on the next query; no data loss",
  pause: "project is paused and must be restored manually; traffic does not auto-resume it",
  expire: "the free database is deleted after a fixed window",
  bill: "usage beyond the free allowance is charged",
  block_writes: "reads continue but writes are blocked until you free space or raise the limit",
});

// Allowance metrics a workload can be checked against (others — projects,
// branches — are informational).
const FIT_METRICS = new Set([
  "compute",
  "storage",
  "egress",
  "file_storage",
  "mau",
  "request_units",
]);

function durabilityOf(source) {
  return {
    requiresCard: source.requiresCard ?? null,
    newCustomerOnly: source.newCustomerOnly ?? null,
    durationDays: source.durationDays ?? null,
    graceDays: source.graceDays ?? null,
    onIdle: source.onIdle ?? null,
    onExceed: source.onExceed ?? null,
    dataLoss: source.dataLoss ?? null,
    backups: source.backups ?? null,
    pitr: source.pitr ?? null,
  };
}

/** The vendor's $0 offering: a real free plan, or a recurring credit, or none. */
function resolveOffering(vendor) {
  for (const [key, plan] of Object.entries(vendor.plans)) {
    if (plan.billed === false && plan.allowances) {
      return {
        source: "plan",
        planKey: key,
        allowances: plan.allowances,
        compute: plan.compute ?? null,
        onExceed: plan.onExceed ?? null,
        paidFallback: plan.paidFallback ?? null,
        note: plan.note ?? null,
        durability: durabilityOf(plan),
      };
    }
  }
  if (vendor.creditAllowances) {
    return {
      source: "credit",
      planKey: null,
      allowances: vendor.creditAllowances,
      compute: null,
      onExceed: "bill",
      paidFallback: null,
      note: vendor.freeNote ?? null,
      durability: durabilityOf({ requiresCard: vendor.creditRequiresCard, onExceed: "bill" }),
    };
  }
  return null;
}

/**
 * One normalized fit fact. `category` is "consumption" (a usage cap whose breach
 * suspends/pauses/bills) or "capacity" (the instance's RAM/vCPU ceiling — a hard
 * limit on a fixed free instance: a peak larger than the instance can't run).
 * Both categories gate the headline fit; the label lets presentation group them.
 * Peak RAM is `peakCu × 4` unless the caller passes an explicit --peak-ram-gb.
 */
function fact(dimension, workload, limit, unit, { basis, category = "consumption" } = {}) {
  const fits = limit == null || workload == null ? null : workload <= limit;
  const headroom = fits && limit > 0 ? 1 - workload / limit : null;
  return {
    dimension,
    category,
    workload: workload ?? null,
    limit: limit ?? null,
    unit,
    fits,
    headroom,
    ...(basis ? { basis } : {}),
  };
}

/** Normalized capacity + budget + allowance facts (raw data for comparison). */
function buildFitFacts(usage, offering) {
  const facts = [];
  const c = offering.compute;
  if (c) {
    if (c.maxRamGb != null) {
      facts.push(fact("compute.ram", usage.peakRamGb, c.maxRamGb, "GB", { category: "capacity" }));
    }
    if (c.maxVcpu != null) {
      facts.push(fact("compute.vcpu", usage.peakVcpu, c.maxVcpu, "vCPU", { category: "capacity" }));
    }
    if (c.budget?.unit === "CU-hour") {
      facts.push(fact("compute.budget", usage.compute, Number(c.budget.amount), "CU-hour"));
    }
  }
  for (const [metric, a] of Object.entries(offering.allowances)) {
    if (!FIT_METRICS.has(metric) || a.limit == null) continue;
    let workload = usage[metric];
    let basis;
    if (workload != null && /GiB/i.test(a.unit)) {
      workload *= GIB_FROM_GB;
      basis = "GB→GiB";
    }
    facts.push(fact(metric, workload, Number(a.limit), a.unit, { basis }));
  }
  return facts;
}

/** Check a resolved usage map against one vendor's free/credit offering. */
export function fitsFreeTier(vendorKey, usage = {}) {
  const vendor = VENDORS[vendorKey];
  if (!vendor) throw new Error(`unknown vendor: ${vendorKey}`);
  const kind = vendor.freeKind ?? "none";
  const base = {
    vendor: vendorKey,
    vendorLabel: vendor.label,
    freeKind: kind,
    freeKindLabel: FREE_KIND_LABEL[kind] ?? kind,
  };
  const offering = resolveOffering(vendor);
  if (!offering) {
    return { ...base, hasFreeTier: false, freeNote: vendor.freeNote ?? null };
  }

  // Query-priced free offerings (CockroachDB's $15 credit) meter Request Units,
  // not CU-hours — so the workload's `compute` (CU-hours) and `egress` would
  // never be checked against the RU allowance, and any workload would "fit" on
  // RU. Bridge both to RU from the paid plan's own rates (CU→RU factor; egress
  // priced as RU) so the RU cap is actually tested.
  const usageChecked = { ...usage };
  if (
    offering.allowances.request_units &&
    usageChecked.request_units == null &&
    usageChecked.compute != null
  ) {
    const ruPlan = Object.values(vendor.plans).find((p) => p.cuToRuPerHour);
    if (ruPlan) {
      let ru = usageChecked.compute * (ruPlan.cuToRuPerHour / 1e6); // million RU
      // Egress is billed as RU too; derive million-RU-per-GB from the paid rates
      // ($/GB ÷ $/million-RU) so the free check counts egress against the credit.
      const egRate = Number(ruPlan.metrics?.egress?.overageRate);
      const ruRate = Number(ruPlan.metrics?.request_units?.overageRate);
      if (usageChecked.egress != null && egRate > 0 && ruRate > 0) {
        ru += usageChecked.egress * (egRate / ruRate);
      }
      usageChecked.request_units = ru;
    }
  }

  // Display lines from the raw allowances (kept for the itemized view). When the
  // allowance is in GiB, `predicted` is shown in GiB too (with `basis`) so the
  // value and its unit are consistent.
  const lines = Object.entries(offering.allowances).map(([metric, a]) => {
    const limit = a.limit == null ? null : Number(a.limit);
    let predicted = usageChecked[metric] ?? null;
    let basis;
    if (predicted != null && a.unit && /GiB/i.test(a.unit)) {
      predicted *= GIB_FROM_GB;
      basis = "GB→GiB";
    }
    const checkable = FIT_METRICS.has(metric) && predicted != null && limit != null;
    const within = checkable ? predicted <= limit : null;
    return {
      metric,
      unit: a.unit,
      predicted,
      limit,
      scope: a.scope ?? null,
      within,
      overBy: within === false ? predicted - limit : 0,
      ...(basis ? { basis } : {}),
      note: a.note ?? null,
    };
  });
  const fitFacts = buildFitFacts(usageChecked, offering);

  // Capacity notes: RAM/vCPU ceilings the peak exceeds, plus a shared-CPU note
  // for fixed free instances (which don't meter compute as a CU-hour budget, so
  // "compute" never appears in `limiting` — the constraint is the instance size).
  const capacityNotes = fitFacts
    .filter((f) => f.category === "capacity" && f.fits === false)
    .map((f) => `${f.dimension} peak ${f.workload} ${f.unit} > free ${f.limit} ${f.unit}`);
  if (offering.compute?.sharedCpu === true && (usage.peakVcpu ?? 0) >= 1) {
    capacityNotes.push(`shared CPU (< 1 vCPU) vs peak ~${usage.peakVcpu} vCPU`);
  }

  return {
    ...base,
    hasFreeTier: true,
    source: offering.source, // "plan" | "credit"
    plan: offering.planKey,
    onExceed: offering.onExceed,
    paidFallback: offering.paidFallback,
    note: offering.note,
    compute: offering.compute,
    durability: offering.durability,
    // The headline fit gates on HARD consumption caps (storage, egress, compute
    // budget, MAU, RU) always, plus capacity: the vCPU ceiling exactly, the RAM
    // ceiling only when grossly exceeded (see capacityGates / factGates).
    fits: lines.every((l) => l.within !== false) && fitFacts.every((f) => !factGates(f)),
    limiting: [
      ...new Set([
        ...lines.filter((l) => l.within === false).map((l) => l.metric),
        ...fitFacts
          .filter((f) => f.category === "capacity" && capacityGates(f))
          .map((f) => f.dimension),
      ]),
    ],
    // Capacity ceilings the workload's peak exceeds — informational, factual.
    capacityNotes,
    lines,
    // Each fact carries `gates` (does it fail the headline fit?) so presentation
    // layers signal "over" consistently with the boolean.
    fitFacts: fitFacts.map((f) => ({ ...f, gates: factGates(f) })),
  };
}

function numericMetrics(metrics = {}) {
  const out = {};
  for (const [key, value] of Object.entries(metrics)) out[key] = Number(value);
  return out;
}

/**
 * Compare a workload against every vendor's free tier. Emits fit + raw fit facts
 * + capability/durability per vendor, and — when a workload overflows — the paid
 * fallback's cost (via compareWorkload).
 */
export function compareFreeTiers(workload, { vendors } = {}) {
  const selected = vendors?.length ? vendors : Object.keys(VENDORS);
  // Peak can't be below average; if only avg is given, peak defaults to it (so
  // capacity and paid-fallback instance sizing aren't understated).
  const peakCu = workload.peakCu ?? workload.avgCu ?? 0;
  const utilization = workload.utilization ?? 0.5;
  const avgCu = workload.avgCu ?? peakCu * utilization;
  const activeHours = workload.activeHours ?? HOURS_PER_MONTH;
  const computeCuHours = avgCu * activeHours;
  const usage = {
    ...numericMetrics(workload.metrics),
    compute: computeCuHours,
    peakVcpu: peakCu, // 1 CU = 1 vCPU
    peakRamGb: peakCu * 4, // 1 CU = 4 GB
  };
  const paidWorkload = { peakCu, avgCu, utilization, activeHours, metrics: workload.metrics };

  const rows = selected.map((vendorKey) => {
    const fit = fitsFreeTier(vendorKey, usage);
    if (!fit.hasFreeTier || fit.fits || !fit.paidFallback) {
      return { ...fit, wouldCost: null };
    }
    const comparison = compareWorkload(paidWorkload, { vendors: [vendorKey] });
    const fallback = comparison.rows.find((r) => r.plan === fit.paidFallback) ?? comparison.rows[0];
    return { ...fit, wouldCost: fallback ? fallback.autoscaledTotal : null };
  });

  return {
    disposition: "free_comparison",
    workload: {
      peakCu,
      avgCu,
      activeHours,
      computeCuHours,
      peakVcpu: peakCu,
      peakRamGb: peakCu * 4,
      metrics: workload.metrics,
    },
    rows,
  };
}
