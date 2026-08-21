// How each vendor bills, and a factual diff against Neon. The `billing`
// descriptor on each vendor is the mechanism; the diff is derived (never
// hand-authored) so a "how X bills vs Neon" view stays factual and current.

import { deepFreeze } from "./util.mjs";
import { VENDORS } from "./vendors.mjs";

/** Plain-language meaning of the billing enum values — for docs, UI, and the
 * verification prompt. Kept here so there's one definition of each term. */
export const BILLING_GLOSSARY = deepFreeze({
  computeUnit: {
    "CU-hour": "per compute-unit-hour (1 CU = 1 vCPU + 4 GB RAM)",
    "ACU-hour": "per Aurora-capacity-unit-hour (1 ACU ≈ 2 GB RAM)",
    "instance-month": "flat monthly price for a chosen fixed instance size",
    "instance-hour": "hourly price for a chosen fixed instance size",
    "cluster-month": "flat monthly price for a chosen fixed cluster SKU",
    "vCPU+RAM-minute": "metered per vCPU-minute and per GB-RAM-minute",
    "Request-Unit": "per-query cost in Request Units (not tied to vCPU-time)",
  },
  costDriver: {
    actual_usage: "cost tracks actual consumption (idle/scale-down costs less)",
    provisioned_peak: "cost is fixed by the size provisioned for peak, regardless of use",
    query_volume: "cost tracks the number/complexity of queries",
  },
  storage: {
    decoupled_per_gb: "storage billed separately, per GB",
    bundled_in_instance: "storage included in the instance price",
    per_gb_per_node: "storage billed per GB, multiplied per node/replica",
  },
  scaleToZero: {
    true: "compute suspends to zero when idle (no idle charge)",
    false: "no scale-to-zero; idle time is billed",
  },
  autoscaling: {
    true: "compute scales its size up and down with load automatically",
    false: "fixed size; you resize manually",
  },
});

// Fields compared, in display order.
const FIELDS = [
  "computeUnit",
  "granularity",
  "scaleToZero",
  "autoscaling",
  "storage",
  "storageUnit",
  "minimum",
  "costDriver",
];

/**
 * Factual billing comparison of a vendor against Neon (the reference). Returns
 * both vendors' descriptors and the field-by-field diffs (only where they
 * differ) — plain data, no wording/judgment.
 */
export function billingVsNeon(vendorKey) {
  const vendor = VENDORS[vendorKey];
  if (!vendor) {
    throw new Error(`unknown vendor: ${vendorKey} (known: ${Object.keys(VENDORS).join(", ")})`);
  }
  const neon = VENDORS.neon.billing ?? {};
  const billing = vendor.billing ?? {};
  const diffs = FIELDS.filter((field) => billing[field] !== neon[field]).map((field) => ({
    field,
    vendor: billing[field] ?? null,
    neon: neon[field] ?? null,
  }));
  return {
    vendor: vendorKey,
    vendorLabel: vendor.label,
    billing,
    neonBilling: neon,
    diffs,
  };
}
