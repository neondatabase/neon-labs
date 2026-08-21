// Neon-vs-competitor comparison — features (a capability matrix) + a head-to-head
// COST (the user's current fixed instance, 24/7, vs the derived Neon workload
// autoscaled). Vendor-GENERIC: Neon is the "home" vendor; every other vendor with
// data in neon-pricing-core is a comparable competitor. Nothing here hardcodes a
// specific competitor — add a vendor to the core's data and it appears automatically.
//
// GUARDRAIL: competitor figures are ESTIMATES from a dated source (cite source +
// retrievedAt); the comparison must stay honest about the assumptions (competitor =
// fixed 24/7; Neon = autoscaling + scale-to-zero).
import {
  compareFeatures,
  estimateVendor,
  vendorMeta,
  vendorPlan,
  vendorPlans,
  LISTED_VENDORS,
} from "./pricing-core/index.mjs";

const HOME = "neon"; // the vendor everyone is compared against
const round2 = (n) => Math.round(n * 100) / 100;

/** Vendors we can compare Neon against (every listed vendor except Neon itself). */
export const COMPETITORS = LISTED_VENDORS.filter((v) => v !== HOME);

// The Neon plan ladder for the plan-to-plan (Free → paid) feature view. Unlike the
// vendor-vs-vendor comparison (paid tiers only), this INCLUDES Free — it answers
// "I'm on Free; what do I gain by upgrading?".
const NEON_LADDER = ["free", "launch", "scale"];

/**
 * The paid, self-serve tiers to show for a vendor — derived from plan metadata, not
 * hardcoded per vendor: billed (excludes Free), with real rates (excludes quote-only
 * Enterprise and assumed-rate plans). Yields Neon [launch, scale], Supabase [pro, team].
 */
export function displayTiers(vendor) {
  return vendorPlans(vendor).filter((p) => {
    const rec = vendorPlan(vendor, p);
    return rec && rec.billed !== false && rec.ratesAssumed !== true;
  });
}

/** The entry paid tier for a vendor (the one the cost head-to-head prices). */
function entryPaidPlan(vendor) {
  return displayTiers(vendor)[0];
}

const columnsFor = (vendors) => vendors.flatMap((v) => displayTiers(v).map((plan) => ({ vendor: v, plan })));

/** Capability matrix for a set of vendors (default: Neon + every competitor). */
export function featureMatrix(vendors = [HOME, ...COMPETITORS]) {
  return compareFeatures(columnsFor(vendors));
}

/** Neon-only plan capability matrix — the Free → Launch → Scale ladder. */
export function neonFeatures() {
  return compareFeatures(NEON_LADDER.map((plan) => ({ vendor: HOME, plan })));
}

const bad400 = (msg) => Object.assign(new Error(msg), { status: 400 });

/**
 * Endpoint scope resolver:
 *   - tier given (e.g. "free") → that plan across EVERY vendor that has it (Neon vs
 *     competitors at the same tier — e.g. Neon Free vs Supabase Free)
 *   - plans given            → exactly those plans of `vendor` (defaults to Neon)
 *   - "neon"                 → the Neon ladder (Free → Launch → Scale)
 *   - a known competitor     → Neon vs that competitor (paid tiers)
 *   - absent / "all"         → Neon vs every competitor (default; paid tiers)
 * Throws a 400-tagged error for an unknown vendor, plan, or tier.
 */
export function featuresFor(vendor, plans, tier) {
  if (tier) {
    const cols = [HOME, ...COMPETITORS].filter((v) => vendorPlans(v).includes(tier)).map((v) => ({ vendor: v, plan: tier }));
    if (!cols.length) throw bad400(`no vendor has a '${tier}' tier. Try 'free'.`);
    return compareFeatures(cols);
  }
  if (plans?.length) {
    const v = vendor && vendor !== "all" ? vendor : HOME;
    if (!LISTED_VENDORS.includes(v)) throw bad400(`unknown vendor '${v}'. Available: ${LISTED_VENDORS.join(", ")}.`);
    const valid = vendorPlans(v);
    const unknown = plans.filter((p) => !valid.includes(p));
    if (unknown.length) throw bad400(`unknown ${v} plan(s): ${unknown.join(", ")}. Available: ${valid.join(", ")}.`);
    return compareFeatures(plans.map((plan) => ({ vendor: v, plan })));
  }
  if (!vendor || vendor === "all") return featureMatrix();
  if (vendor === HOME) return neonFeatures();
  if (COMPETITORS.includes(vendor)) return featureMatrix([HOME, vendor]);
  throw bad400(
    `unknown vendor '${vendor}'. Available: ${[HOME, ...COMPETITORS].join(", ")} (or omit / 'all' for the full comparison).`,
  );
}

/**
 * Price a specific vendor plan DIRECTLY — no workload extraction. For "what does a
 * known Supabase Pro Large cost?" or comparing a known instance head-to-head.
 * usage passes straight through: instance (per-instance vendors), storageGb, egressGb,
 * and computeCuHours (Neon's CU-hour model). Returns line items + provenance.
 */
export function priceVendorPlan({ vendor, plan, instance, storageGb, egressGb, computeCuHours } = {}) {
  if (!LISTED_VENDORS.includes(vendor)) throw bad400(`unknown vendor '${vendor}'. Available: ${LISTED_VENDORS.join(", ")}.`);
  const chosen = plan ?? entryPaidPlan(vendor);
  if (!vendorPlans(vendor).includes(chosen)) throw bad400(`unknown ${vendor} plan '${chosen}'. Available: ${vendorPlans(vendor).join(", ")}.`);
  const usage = {};
  if (computeCuHours != null) usage.compute = String(computeCuHours);
  if (storageGb != null) usage.storage = String(storageGb);
  if (egressGb != null) usage.egress = String(egressGb);
  const meta = vendorMeta(vendor);
  const est = estimateVendor(vendor, chosen, usage, instance ? { instance } : {});
  return {
    vendor,
    plan: chosen,
    instance: instance ?? null,
    monthlyTotal: est.monthlyTotal.display,
    amount: est.monthlyTotal.amount,
    lines: est.lines.filter((l) => l.amount && l.amount.amount > 0).map((l) => ({ label: l.label, amount: l.amount.display })),
    sources: meta?.sources ?? [],
    retrievedAt: meta?.retrievedAt,
  };
}

/**
 * Compact summary of a matrix: capabilities unique to Neon vs unique to the
 * competitor side. A capability counts for a side if ANY of that side's tiers has it.
 */
export function featureSummary(matrix = featureMatrix()) {
  const supportsAny = (pred, key) => matrix.vendors.some((v) => pred(v.vendor) && v.cells[key]?.supported);
  const neonOnly = [];
  const competitorOnly = [];
  for (const d of matrix.dimensions) {
    const n = supportsAny((v) => v === HOME, d.key);
    const c = supportsAny((v) => v !== HOME, d.key);
    if (n && !c) neonOnly.push(d.label);
    else if (c && !n) competitorOnly.push(d.label);
  }
  return { dimensions: matrix.dimensions.length, neonOnly, competitorOnly };
}

/** Price a vendor's CURRENT fixed instance (billed 24/7) on its entry paid plan. */
export function vendorCost(vendor, { instance, dbSizeGb, egressGb } = {}) {
  const plan = entryPaidPlan(vendor);
  const usage = { storage: String(dbSizeGb ?? 0), egress: String(egressGb ?? 0) };
  const meta = vendorMeta(vendor);
  const base = { vendor, plan, instance: instance ?? null, sources: meta?.sources ?? [], retrievedAt: meta?.retrievedAt };
  try {
    const est = estimateVendor(vendor, plan, usage, instance ? { instance } : {});
    return {
      ...base,
      monthlyTotal: est.monthlyTotal.display,
      amount: est.monthlyTotal.amount,
      lines: est.lines.filter((l) => l.amount && l.amount.amount > 0).map((l) => ({ label: l.label, amount: l.amount.display })),
      note: instance ? null : `no instance size given — only the base plan fee is priced (${meta?.label ?? vendor} compute is per-instance).`,
    };
  } catch (err) {
    // e.g. an instance size with no pricing-grid entry for this vendor.
    return { ...base, monthlyTotal: null, amount: null, note: `${meta?.label ?? vendor} compute not priced: ${err instanceof Error ? err.message : "error"}` };
  }
}

/**
 * Head-to-head: the user's fixed competitor instance (24/7) vs the derived Neon
 * workload (autoscaled). `vendor` = which competitor; `neonEst` = { launch, scale }
 * trimmed estimates. Returns cost.competitor (with .vendor) + a feature summary.
 */
export function compareToNeon(vendor, signals = {}, neonEst = {}) {
  const competitor = vendorCost(vendor, signals);
  const launch = neonEst.launch ?? null;
  const scale = neonEst.scale ?? null;
  const deltaVsLaunch = competitor.amount != null && launch ? round2(competitor.amount - launch.amount) : null;
  const label = vendorMeta(vendor)?.label ?? vendor;
  return {
    cost: {
      competitor,
      neonLaunch: launch ? { monthlyTotal: launch.monthlyTotal, amount: launch.amount } : null,
      neonScale: scale ? { monthlyTotal: scale.monthlyTotal, amount: scale.amount } : null,
      deltaVsLaunch,
      note:
        `${label} = your CURRENT fixed instance billed 24/7; Neon = the derived workload autoscaled. ` +
        `${label} figures are an estimate (see source/retrievedAt); Neon presupposes autoscaling + scale-to-zero. ` +
        "A busy, always-on workload narrows this gap — an idle/bursty one widens it.",
    },
    features: featureSummary(featureMatrix([HOME, vendor])),
  };
}
