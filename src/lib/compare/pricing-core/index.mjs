// neon-pricing-core — Neon pricing + a Neon-vs-Supabase comparison (features + rates).
// Wraps a vendor-neutral engine (./engine). Vendor DATA is limited to **Neon +
// Supabase** — other competitors are intentionally excluded from the tree. Supabase
// rates/features come from the canonical backend-cost-forecast table; any comparison
// output must cite `source` + `retrievedAt` and mark competitor figures as estimates.
// Not published (private).

import {
  estimate as _estimate,
  fitsFreeTier as _fits,
  compareFeatures,
  FEATURE_DIMENSIONS,
  VENDORS,
  money,
  parseDecimal,
  GB_PER_CU,
  HOURS_PER_MONTH,
} from "./engine/index.mjs";
import { metricLabel, metricCategory } from "./engine/catalog.mjs";

const NEON = "neon";

/** All Neon plan keys, and the billed ones (exclude Free / quote-only). */
export const NEON_PLANS = Object.keys(VENDORS[NEON].plans);
export const NEON_BILLED_PLANS = NEON_PLANS.filter((p) => VENDORS[NEON].plans[p].billed !== false);

/** Neon billing descriptor (CU-hour / second / scale-to-zero / autoscaling …). */
export const neonBilling = VENDORS[NEON].billing;

/** 1 CU = 1 vCPU + 4 GB RAM; a billing month = 744 h. */
export { GB_PER_CU, HOURS_PER_MONTH };

/** Itemized Neon estimate for one plan. usage = { compute (CU-hours), storage, egress, ... }. */
export function estimate(plan, usage, options) {
  return _estimate(NEON, plan, usage, options);
}

/** Does a usage map fit Neon's Free tier? (fit facts + limiting dims). */
export function fitsFree(usage) {
  return _fits(NEON, usage);
}

/** Raw Neon plan record (rates, allowances, notes). */
export function neonPlan(plan) {
  return VENDORS[NEON].plans[plan];
}

/** Generic vendor estimate (Neon or Supabase) — powers head-to-head comparison. */
export function estimateVendor(vendor, plan, usage, options) {
  return _estimate(vendor, plan, usage, options);
}

/** Vendors with data in this package (Neon + Supabase only). */
export const LISTED_VENDORS = Object.keys(VENDORS);

/** Plan keys for any listed vendor (e.g. ["free","launch","scale",…]). */
export function vendorPlans(vendor) {
  return Object.keys(VENDORS[vendor]?.plans ?? {});
}

/** Raw plan record for any listed vendor (rates/allowances/instances). */
export function vendorPlan(vendor, plan) {
  return VENDORS[vendor]?.plans?.[plan];
}

/**
 * Machine-readable rate card for one vendor (or all listed vendors, if omitted).
 * The source of truth for "what does X cost" and for computing an estimate yourself:
 * per-plan per-metric rates (unit, rate, included quota), the instance grid, the
 * billing model, and `sources`. Derived straight from the vendor data — no drift.
 */
export function rateCard(vendor) {
  const keys = (vendor ? [vendor] : LISTED_VENDORS).filter((k) => VENDORS[k]);
  return keys.map((k) => {
    const v = VENDORS[k];
    return {
      vendor: k,
      label: v.label,
      currency: v.currency,
      billing: v.billing ?? null,
      sources: v.sources ?? (v.sourceUrl ? [v.sourceUrl] : []),
      retrievedAt: v.retrievedAt ?? null,
      plans: Object.entries(v.plans).map(([plan, p]) => ({
        plan,
        label: p.label,
        billed: p.billed !== false,
        ratesAssumed: p.ratesAssumed ?? false,
        computeModel: p.computeModel ?? null,
        baseMonthlyFee: p.baseMonthlyFee ?? null,
        computeCreditMonthly: p.computeCreditMonthly ?? null,
        rates: Object.fromEntries(
          Object.entries(p.metrics ?? {}).map(([metric, r]) => [
            metric,
            {
              label: metricLabel(metric),
              category: metricCategory(metric),
              unit: r.unit ?? null,
              rate: r.overageRate ?? null,
              includedQuota: r.includedQuota ?? null,
              ...(r.scope ? { scope: r.scope } : {}),
            },
          ]),
        ),
        instances: Object.fromEntries(
          Object.entries(p.instances ?? {}).map(([ik, inst]) => [
            ik,
            { label: inst.label, ramGb: inst.ramGb ?? null, monthlyPrice: inst.monthlyPrice ?? null },
          ]),
        ),
      })),
    };
  });
}

/** Provenance/meta for a listed vendor (label, currency, sources[], retrievedAt).
 *  `sources` lists the authoritative pages (pricing/docs are the SoT), primary first. */
export function vendorMeta(vendor) {
  const v = VENDORS[vendor];
  if (!v) return null;
  const sources = v.sources ?? (v.sourceUrl ? [v.sourceUrl] : []);
  return { label: v.label, currency: v.currency, sources, retrievedAt: v.retrievedAt };
}

/** Neon-only feature/capability matrix for the given plans (default: billed plans). */
export function planFeatures(plans = NEON_BILLED_PLANS) {
  return compareFeatures(plans.map((plan) => ({ vendor: NEON, plan })));
}

/** What you gain moving from one Neon plan to another (added/changed capabilities). */
export function planUpgradeDiff(fromPlan, toPlan) {
  const { dimensions, vendors } = compareFeatures([
    { vendor: NEON, plan: fromPlan },
    { vendor: NEON, plan: toPlan },
  ]);
  const [from, to] = vendors;
  const gains = [];
  for (const d of dimensions) {
    const a = from.cells[d.key];
    const b = to.cells[d.key];
    if (b && (!a || a.description !== b.description || a.supported !== b.supported)) {
      gains.push({ dimension: d.key, label: d.label, from: a?.description ?? null, to: b.description });
    }
  }
  return gains;
}

export { compareFeatures, FEATURE_DIMENSIONS, money, parseDecimal };
