// Metric labels/order, exclusions, and introspection helpers a UI can use to
// build vendor/plan/instance/metric pickers without reaching into VENDORS.

import { deepFreeze } from "./util.mjs";
import { VENDORS } from "./vendors.mjs";

const METRIC_LABELS = deepFreeze({
  compute: "Compute",
  compute_vcpu: "Compute (vCPU)",
  compute_ram: "Compute (RAM)",
  request_units: "Request units",
  storage: "Storage",
  child_storage: "Storage (child branches)",
  instant_restore: "Instant restore",
  snapshots: "Snapshots",
  tiered_storage: "Tiered storage",
  backups: "Backups",
  egress: "Egress",
  cached_egress: "Cached egress",
  private_transfer: "Private transfer",
  file_storage: "File storage",
  io: "I/O",
  mau: "Monthly active users",
  branches: "Branches",
});
const METRIC_ORDER = Object.freeze(Object.keys(METRIC_LABELS));

const EXCLUSIONS = deepFreeze([
  "credits",
  "taxes",
  "custom_contract_terms",
  "minimum_invoice_commitments",
  "rounding_differences",
]);

// Coarse cost category per metric — a reusable, presentation-agnostic grouping
// (compute vs storage vs egress vs other) that a breakdown/matrix view (web or
// CLI) can bucket by. Kept here with the metric definitions as the single
// source; unknown metrics fall back to "other".
const METRIC_CATEGORY = deepFreeze({
  compute: "compute",
  compute_vcpu: "compute",
  compute_ram: "compute",
  request_units: "compute",
  io: "compute",
  storage: "storage",
  child_storage: "storage",
  instant_restore: "storage",
  snapshots: "storage",
  tiered_storage: "storage",
  backups: "storage",
  file_storage: "storage",
  egress: "egress",
  cached_egress: "egress",
  private_transfer: "egress",
  mau: "other",
  branches: "other",
});

function metricLabel(metric) {
  return METRIC_LABELS[metric] ?? metric;
}

/** Coarse cost category for a metric: "compute" | "storage" | "egress" | "other". */
function metricCategory(metric) {
  return METRIC_CATEGORY[metric] ?? "other";
}

/** Order provided metrics: known order first, then any extras. */
function orderedMetrics(names) {
  const known = METRIC_ORDER.filter((metric) => names.includes(metric));
  const extra = names.filter((metric) => !METRIC_ORDER.includes(metric));
  return [...known, ...extra];
}

/** Vendors as plain data for building UIs. */
export function listVendors() {
  return Object.entries(VENDORS).map(([key, vendor]) => ({
    key,
    label: vendor.label,
    currency: vendor.currency,
    sourceUrl: vendor.sourceUrl,
    sources: vendor.sources ?? (vendor.sourceUrl ? [vendor.sourceUrl] : []),
    retrievedAt: vendor.retrievedAt ?? null,
    region: vendor.region ?? null,
    freeKind: vendor.freeKind ?? "none",
    plans: Object.keys(vendor.plans),
  }));
}

/** The raw vendor entry (rates included), or undefined. */
export function getVendor(vendorKey) {
  return VENDORS[vendorKey];
}

/** Plans for a vendor as plain data (compute model, base fee, instances, metrics). */
export function listPlans(vendorKey) {
  const vendor = VENDORS[vendorKey];
  if (!vendor) return [];
  return Object.entries(vendor.plans).map(([key, plan]) => ({
    key,
    label: plan.label,
    billed: plan.billed !== false,
    computeModel: plan.computeModel ?? null,
    baseMonthlyFee: plan.baseMonthlyFee ?? null,
    ratesAssumed: plan.ratesAssumed ?? false,
    instances: listInstances(vendorKey, key),
    metrics: Object.keys(plan.metrics ?? {}),
  }));
}

/** Instance sizes for a vendor/plan as plain data. `priceUnit` tells consumers
 *  whether `monthlyPrice` is per month or (for instance_hour plans, e.g. Xata)
 *  actually a per-hour rate — so a UI doesn't render an hourly figure as "/mo". */
export function listInstances(vendorKey, planKey) {
  const plan = VENDORS[vendorKey]?.plans?.[planKey];
  const priceUnit = plan?.computeModel === "instance_hour" ? "hour" : "month";
  return Object.entries(plan?.instances ?? {}).map(([key, inst]) => ({
    key,
    label: inst.label,
    ramGb: inst.ramGb ?? null,
    monthlyPrice: inst.monthlyPrice ?? null,
    priceUnit,
  }));
}

/** Metric name → display label (+ category), for legends and column headers. */
export function metricCatalog() {
  return Object.entries(METRIC_LABELS).map(([metric, label]) => ({
    metric,
    label,
    category: metricCategory(metric),
  }));
}

export {
  EXCLUSIONS,
  METRIC_CATEGORY,
  METRIC_LABELS,
  METRIC_ORDER,
  metricCategory,
  metricLabel,
  orderedMetrics,
};
