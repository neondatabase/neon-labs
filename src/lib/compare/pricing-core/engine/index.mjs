// backend-cost-forecast — library entrypoint.
//
// Vendor-neutral, forward-looking cost estimation. Every export is pure and
// returns plain, JSON-serializable data — import it from a server route, a
// browser bundle, another tool, or the bundled CLI (bin/forecast.mjs).

export { BILLING_GLOSSARY, billingVsNeon } from "./billing.mjs";
export { catalog } from "./bootstrap.mjs";
export {
  EXCLUSIONS,
  getVendor,
  listInstances,
  listPlans,
  listVendors,
  METRIC_LABELS,
  metricCatalog,
  metricCategory,
} from "./catalog.mjs";
export { compareWorkload, GB_PER_CU, HOURS_PER_MONTH, instanceToCu, sweep } from "./compare.mjs";
export { estimate } from "./estimate.mjs";
export { compareFeatures, FEATURE_DIMENSIONS, FEATURES } from "./features.mjs";
export { compareFreeTiers, EXCEED_GLOSSARY, FREE_KIND_LABEL, fitsFreeTier } from "./free.mjs";
// Exact-money helpers for advanced consumers that want to do their own math.
export { money, parseDecimal, toMoney } from "./money.mjs";
export { validateVendors } from "./validate.mjs";
export { VENDORS } from "./vendors.mjs";
