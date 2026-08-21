// One-call UI bootstrap. A frontend needs the same reference data to build every
// control and legend — vendors, their plans/instances/metrics, the metric
// catalog, and the glossaries. `catalog()` assembles it into a single, plain,
// JSON-serializable payload so the UI fetches once instead of stitching together
// listVendors + listPlans + metricCatalog + three glossary imports itself.

import { BILLING_GLOSSARY } from "./billing.mjs";
import { listPlans, listVendors, metricCatalog } from "./catalog.mjs";
import { EXCEED_GLOSSARY, FREE_KIND_LABEL } from "./free.mjs";

/** Everything a UI needs to render pickers + legends, in one payload. */
export function catalog() {
  return {
    // Each vendor summary with its plans expanded (instances + metrics inline).
    vendors: listVendors().map((vendor) => ({ ...vendor, plans: listPlans(vendor.key) })),
    // metric → display label, for column headers and legends.
    metrics: metricCatalog(),
    // Term definitions the UI shows as tooltips/legends.
    glossaries: {
      billing: BILLING_GLOSSARY,
      freeKind: FREE_KIND_LABEL,
      onExceed: EXCEED_GLOSSARY,
    },
  };
}
