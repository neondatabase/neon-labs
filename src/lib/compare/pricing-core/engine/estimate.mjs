// The estimator: price predicted usage for one vendor/plan. Pure; returns a
// plain, JSON-serializable object.

import { EXCLUSIONS, metricLabel, orderedMetrics } from "./catalog.mjs";
import {
  add,
  clampToZero,
  compare,
  GIB_PER_GB,
  money,
  multiply,
  parseDecimal,
  predictedQuantity,
  subtract,
  toApproxNumber,
  ZERO,
} from "./money.mjs";
import { VENDORS } from "./vendors.mjs";

export function estimate(vendorKey, planKey, usage = {}, options = {}) {
  const vendor = VENDORS[vendorKey];
  if (!vendor) {
    throw new Error(`unknown vendor: ${vendorKey} (known: ${Object.keys(VENDORS).join(", ")})`);
  }
  const plan = vendor.plans[planKey];
  if (!plan) {
    const known = Object.keys(vendor.plans).join(", ");
    throw new Error(`unknown ${vendor.label} plan: ${planKey} (known: ${known})`);
  }

  const notes = [];
  if (plan.note) notes.push(plan.note);
  if (plan.ratesAssumed) {
    notes.push(
      `${vendor.label} ${plan.label} rates are documented assumptions, not directly published; a real invoice may differ.`,
    );
  }

  const providedNames = Object.keys(usage).filter(
    (metric) => usage[metric] !== undefined && metric !== "computeHours",
  );

  // Not-billed plans (Free, quote-only Enterprise/BYOC): echo the inputs, bill zero.
  if (plan.billed === false) {
    const lines = orderedMetrics(providedNames).map((metric) => ({
      metric,
      label: metricLabel(metric),
      unit: null,
      predicted: toApproxNumber(predictedQuantity(metricLabel(metric), usage[metric])),
      status: "not_billed",
      amount: money(ZERO),
    }));
    return finalize(vendor, plan, planKey, vendorKey, options, lines, ZERO, notes);
  }

  const baseFee = plan.baseMonthlyFee == null ? ZERO : parseDecimal(plan.baseMonthlyFee);
  const lines = [];
  let usageTotal = ZERO;

  // ---- compute (varies by model) ----
  const computeResult = priceCompute(vendor, plan, usage, options, notes);
  for (const line of computeResult.lines) lines.push(line);
  usageTotal = add(usageTotal, computeResult.amount);

  // ---- per-metric meters ----
  for (const metric of orderedMetrics(providedNames)) {
    // `compute`/`computeHours` are the shared compute inputs consumed by
    // priceCompute above. Split meters (compute_vcpu/compute_ram/request_units)
    // are ordinary metered metrics and fall through to pricePlainMetric.
    if (metric === "compute" || metric === "computeHours") continue;
    const label = metricLabel(metric);
    const definition = plan.metrics?.[metric];
    const predicted = predictedQuantity(label, usage[metric]);
    const line = pricePlainMetric(metric, label, definition, predicted, vendor, plan, notes);
    lines.push(line.line);
    usageTotal = add(usageTotal, line.amount);
  }

  // A usage credit (e.g. Railway's plan fee is a floor that includes an equal
  // credit) offsets metered usage before the base fee is added, so the fee is a
  // floor rather than additive: total = baseFee + max(0, usage − credit).
  const credit = plan.usageCreditMonthly ? parseDecimal(plan.usageCreditMonthly) : ZERO;
  const total = add(baseFee, clampToZero(subtract(usageTotal, credit)));

  return finalize(vendor, plan, planKey, vendorKey, options, lines, total, notes);
}

/** Prices one non-compute metric; returns { line, amount }. */
function pricePlainMetric(metric, label, definition, predicted, vendor, plan, notes) {
  const base = { metric, label, predicted: toApproxNumber(predicted) };
  if (!definition) {
    if (compare(predicted, ZERO) > 0) {
      notes.push(
        `${label} is not available on ${vendor.label} ${plan.label}; excluded from the total.`,
      );
    }
    return { line: { ...base, unit: null, status: "unavailable", amount: null }, amount: ZERO };
  }
  if (definition.note) notes.push(`${label}: ${definition.note}`);
  if (definition.overageRate == null) {
    // The vendor doesn't publish a per-unit rate for this metric (e.g. bundled
    // into the base fee, or region-varying and unpublished).
    return {
      line: { ...base, unit: definition.unit, status: "not_metered", amount: null },
      amount: ZERO,
    };
  }
  let quantity = predicted;
  if (definition.multiplier) quantity = multiply(quantity, parseDecimal(definition.multiplier));
  if (/GiB/.test(definition.unit)) quantity = multiply(quantity, GIB_PER_GB);
  let quota = ZERO;
  if (definition.includedQuota == null) {
    notes.push(`${label}: included allowance is variable/unpublished; assuming 0.`);
  } else {
    quota = parseDecimal(definition.includedQuota);
  }
  const billable = clampToZero(subtract(quantity, quota));
  const rate = parseDecimal(definition.overageRate);
  const amount = multiply(billable, rate);
  return {
    line: {
      ...base,
      unit: definition.unit,
      includedQuota: toApproxNumber(quota),
      billable: toApproxNumber(billable),
      ratePerUnit: definition.overageRate,
      status: "estimated",
      amount: money(amount),
    },
    amount,
  };
}

/** Prices compute per the plan's computeModel; returns { lines, amount }. */
function priceCompute(vendor, plan, usage, options, notes) {
  const model = plan.computeModel ?? "cu_hour";
  const lines = [];

  // Instance-selection models: the chosen size drives compute cost.
  if (model === "instance_month" || model === "instance_hour") {
    const selection = selectInstance(vendor, plan, options, notes);
    // instance_month never uses a CU-hours figure; instance_hour uses hours
    // (from computeHours, else compute). Only say "ignored" when it truly is.
    if (model === "instance_month" && usage.compute !== undefined) {
      notes.push(
        `compute on ${vendor.label} ${plan.label} is priced by instance size (--instance), not CU-hours; the --compute value was ignored.`,
      );
    } else if (
      model === "instance_hour" &&
      usage.computeHours !== undefined &&
      usage.compute !== undefined
    ) {
      notes.push(
        `${vendor.label} ${plan.label} compute is billed per instance-hour; used --compute-hours (the --compute value was ignored).`,
      );
    }
    if (!selection) return { lines, amount: ZERO };
    if (model === "instance_month") {
      let price = parseDecimal(selection.monthlyPrice);
      if (options.ha && plan.haMultiplier) {
        price = multiply(price, parseDecimal(plan.haMultiplier));
      }
      if (plan.computeCreditMonthly) {
        price = clampToZero(subtract(price, parseDecimal(plan.computeCreditMonthly)));
      }
      lines.push({
        metric: "compute",
        label: `Compute (instance: ${selection.label})`,
        unit: "instance-month",
        status: "estimated",
        amount: money(price),
      });
      return { lines, amount: price };
    }
    // instance_hour: instance-hours × the size's hourly rate.
    const hours = usage.computeHours ?? usage.compute;
    if (hours === undefined) {
      notes.push(`provide --compute-hours to price ${vendor.label} ${plan.label} compute.`);
      return { lines, amount: ZERO };
    }
    if (usage.computeHours === undefined && usage.compute !== undefined) {
      notes.push(
        `${vendor.label} ${plan.label} is billed per instance-hour; --compute (${usage.compute}) was interpreted as instance-hours.`,
      );
    }
    const predicted = predictedQuantity("compute", hours);
    const amount = multiply(predicted, parseDecimal(selection.monthlyPrice));
    lines.push({
      metric: "compute",
      label: `Compute (instance: ${selection.label})`,
      unit: "instance-hour",
      predicted: toApproxNumber(predicted),
      ratePerUnit: selection.monthlyPrice,
      status: "estimated",
      amount: money(amount),
    });
    return { lines, amount };
  }

  // Metered models that price the shared `compute` (CU-hour) input.
  if (model === "cu_hour" || model === "acu_hour") {
    if (usage.compute === undefined) return { lines, amount: ZERO };
    const definition = plan.metrics?.compute;
    if (!definition || definition.overageRate == null) {
      notes.push(`${vendor.label} ${plan.label} publishes no compute rate; compute not priced.`);
      return { lines, amount: ZERO };
    }
    const cuHours = predictedQuantity("compute", usage.compute);
    let units = cuHours;
    if (model === "acu_hour") {
      const acuPerCu = parseDecimal(plan.acuPerCu ?? "2");
      units = multiply(cuHours, acuPerCu);
      notes.push(
        `Aurora bills ACU-hours (assumed 1 CU ≈ ${plan.acuPerCu ?? "2"} ACU); adjust if your sizing differs.`,
      );
    }
    const rate = parseDecimal(definition.overageRate);
    const amount = multiply(units, rate);
    lines.push({
      metric: "compute",
      label: "Compute",
      unit: definition.unit,
      predicted: toApproxNumber(cuHours),
      billable: toApproxNumber(units),
      ratePerUnit: definition.overageRate,
      status: "estimated",
      amount: money(amount),
    });
    return { lines, amount };
  }

  // vcpu_ram (Railway) and request_unit (CockroachDB Basic) price their own
  // metrics (compute_vcpu/compute_ram, request_units) via pricePlainMetric.
  if (usage.compute !== undefined) {
    const hint =
      model === "vcpu_ram"
        ? "bills vCPU-hours and RAM-GB-hours separately (use --vcpu-hours and --ram-gb-hours)"
        : "bills query Request Units (use --request-units-millions)";
    notes.push(
      `compute on ${vendor.label} ${plan.label} ${hint}; the --compute value was ignored.`,
    );
  }
  return { lines, amount: ZERO };
}

/** Resolve the --instance selection for an instance-priced plan. */
function selectInstance(vendor, plan, options, notes) {
  const available = Object.keys(plan.instances ?? {});
  if (available.length === 0) {
    notes.push(
      `${vendor.label} ${plan.label} has no published instance grid; compute is not priced (base fee is a floor).`,
    );
    return null;
  }
  if (!options.instance) {
    notes.push(
      `compute needs an instance size on ${vendor.label} ${plan.label}: --instance <${available.join("|")}>.`,
    );
    return null;
  }
  const selection = plan.instances[options.instance];
  if (!selection) {
    throw new Error(
      `unknown instance ${options.instance} for ${vendor.label} ${plan.label} (known: ${available.join(", ")})`,
    );
  }
  return selection;
}

function finalize(vendor, plan, planKey, vendorKey, options, lines, total, notes) {
  const baseFee = plan.baseMonthlyFee == null ? null : parseDecimal(plan.baseMonthlyFee);
  return {
    disposition: "estimate",
    vendor: vendorKey,
    vendorLabel: vendor.label,
    plan: planKey,
    planLabel: plan.label,
    currency: vendor.currency,
    computeModel: plan.computeModel ?? null,
    ...(baseFee ? { baseMonthlyFee: money(baseFee) } : {}),
    ...(options.instance ? { instance: options.instance } : {}),
    ...(vendor.region ? { region: vendor.region } : {}),
    lines,
    monthlyTotal: money(total),
    notes,
    exclusions: EXCLUSIONS,
    sourceUrl: vendor.sourceUrl, // primary, kept for back-compat
    sources: vendor.sources ?? (vendor.sourceUrl ? [vendor.sourceUrl] : []),
    ...(vendor.retrievedAt ? { retrievedAt: vendor.retrievedAt } : {}),
    disclaimer: `Estimate only, not an invoice. Excludes ${EXCLUSIONS.join(", ")}.`,
  };
}
