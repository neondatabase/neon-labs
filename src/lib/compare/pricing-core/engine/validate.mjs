// Vendor-data integrity check. Walks VENDORS and returns a list of problems
// (empty = valid) so a typo in the rate tables fails a test at edit time rather
// than mispricing silently or throwing deep inside estimate(). Run over the
// bundled data by test/vendors.test.mjs; also exported for anyone loading
// custom vendor data.

import { VENDORS } from "./vendors.mjs";

const COMPUTE_MODELS = new Set([
  "cu_hour",
  "acu_hour",
  "instance_hour",
  "instance_month",
  "vcpu_ram",
  "request_unit",
]);
const DECIMAL = /^\d+(\.\d+)?$/;
const isDecimalString = (v) => typeof v === "string" && DECIMAL.test(v);

/** Returns an array of human-readable problems; empty when the data is valid. */
export function validateVendors(vendors = VENDORS) {
  const errors = [];
  const err = (path, message) => errors.push(`${path}: ${message}`);
  const checkDecimal = (path, value, field) => {
    if (value != null && !isDecimalString(value)) {
      err(path, `${field} must be a decimal string (got ${JSON.stringify(value)})`);
    }
  };

  for (const [vendorKey, vendor] of Object.entries(vendors)) {
    if (typeof vendor.label !== "string") err(vendorKey, "missing label");
    if (typeof vendor.currency !== "string") err(vendorKey, "missing currency");
    if (typeof vendor.sourceUrl !== "string") err(vendorKey, "missing sourceUrl");
    if (!vendor.plans || typeof vendor.plans !== "object") {
      err(vendorKey, "missing plans");
      continue;
    }

    for (const [planKey, plan] of Object.entries(vendor.plans)) {
      const path = `${vendorKey}.${planKey}`;
      if (typeof plan.label !== "string") err(path, "missing label");
      if (plan.billed === false) continue; // not-billed plans carry no rate data

      if (plan.computeModel && !COMPUTE_MODELS.has(plan.computeModel)) {
        err(path, `unknown computeModel "${plan.computeModel}"`);
      }
      checkDecimal(path, plan.baseMonthlyFee, "baseMonthlyFee");
      for (const field of [
        "computeCreditMonthly",
        "usageCreditMonthly",
        "haMultiplier",
        "acuPerCu",
      ]) {
        checkDecimal(path, plan[field], field);
      }

      for (const [instanceKey, inst] of Object.entries(plan.instances ?? {})) {
        const ip = `${path}.instances.${instanceKey}`;
        if (typeof inst.label !== "string") err(ip, "missing label");
        if (typeof inst.ramGb !== "number") err(ip, "ramGb must be a number");
        checkDecimal(ip, inst.monthlyPrice, "monthlyPrice");
      }

      for (const [metricKey, def] of Object.entries(plan.metrics ?? {})) {
        const mp = `${path}.metrics.${metricKey}`;
        if (typeof def.unit !== "string") err(mp, "missing unit");
        checkDecimal(mp, def.overageRate, "overageRate");
        checkDecimal(mp, def.includedQuota, "includedQuota");
        checkDecimal(mp, def.multiplier, "multiplier");
      }

      // Instance-priced plans need a size grid — or a note explaining why not.
      if (plan.computeModel === "instance_month" || plan.computeModel === "instance_hour") {
        const hasInstances = Object.keys(plan.instances ?? {}).length > 0;
        if (!hasInstances && !plan.note) {
          err(path, "instance-priced plan has no instances and no explanatory note");
        }
      }
      // acu_hour plans should declare their ACU-per-CU factor (defaults to 2).
      if (plan.computeModel === "acu_hour" && plan.acuPerCu == null) {
        err(path, "acu_hour plan should declare acuPerCu");
      }
    }
  }
  return errors;
}
