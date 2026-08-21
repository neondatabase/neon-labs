// Cross-vendor comparison + instance↔CU conversion. Pure; returns plain data.

import { EXCLUSIONS } from "./catalog.mjs";
import { estimate } from "./estimate.mjs";
import { multiply, parseDecimal } from "./money.mjs";
import { VENDORS } from "./vendors.mjs";

// ---------------------------------------------------------------------------
// Cross-vendor comparison + instance↔CU conversion.
//
// The guides frame the core difference well: "autoscaling pays near the average
// while still serving the peak; a fixed instance pays for peak capacity all
// month" and "Neon bills the hours the database runs; a fixed instance bills the
// month." To compare fairly we describe ONE workload by its PEAK and its AVERAGE
// active load, then price two scenarios:
//
//   Autoscaled       — vendors that autoscale bill the AVERAGE CU, and those
//                      that scale to zero bill only the ACTIVE hours.
//   Fixed at peak    — everyone billed for the PEAK, 24/7 (what a provisioned
//                      instance costs, and what Neon would cost with autoscaling
//                      and scale-to-zero turned off).
//
// The peak always sizes the fixed-instance vendors (they must "clear the peak,
// all month"); the gap between the two columns is the autoscaling + scale-to-
// zero saving. Neon reports production workloads use ~2.4x less compute under
// autoscaling than provisioning at peak + 20% headroom (average ≈ half of peak),
// which is the default assumption below — override it with avgCu/utilization.
// ---------------------------------------------------------------------------

const HOURS_PER_MONTH = 744;
const GB_PER_CU = 4; // 1 CU = 1 vCPU + 4 GB RAM
// Default average-to-peak ratio for an autoscaled workload when the caller gives
// only a peak. Grounded in Neon's cited ~2.4x-less-than-peak+20% figure; a
// labeled assumption, always overridable via avgCu or utilization.
const AUTOSCALE_UTILIZATION = 0.5;

// One representative billed plan per vendor for comparison (Neon shows both its
// usage tiers). Falls back to the first billed plan.
const COMPARE_PLANS = {
  neon: ["launch", "scale"],
  supabase: ["pro"],
};

function firstBilledPlan(vendor) {
  const entry = Object.entries(vendor.plans).find(([, plan]) => plan.billed !== false);
  return entry?.[0];
}

/**
 * Smallest instance that covers the peak on its BINDING dimension: RAM always,
 * and vCPU when the SKU publishes it — a RAM-only match can under-provision CPU
 * on vendors like PlanetScale (8 GB RAM per vCPU, 2× a Neon CU). When the plan
 * offers HA (multi-node) SKUs, size against those (the production default);
 * single-node SKUs are out-of-SLA. Largest (flagged undersized) if none covers.
 */
function chooseInstance(plan, { peakRamGb, peakVcpu }) {
  const all = Object.entries(plan.instances ?? {}).filter(([, i]) => typeof i.ramGb === "number");
  if (all.length === 0) return null;
  const hasHa = all.some(([, i]) => i.ha === true);
  // Smallest by RAM, then cheapest at a given RAM — so two same-RAM SKUs (e.g.
  // Render basic-4gb $75 vs pro-4gb $55) pick the cheaper adequate one.
  const pool = (hasHa ? all.filter(([, i]) => i.ha === true) : all).sort(
    (a, b) => a[1].ramGb - b[1].ramGb || Number(a[1].monthlyPrice) - Number(b[1].monthlyPrice),
  );
  const covers = ([, i]) => i.ramGb >= peakRamGb && (i.vCPU == null || i.vCPU >= peakVcpu);
  const adequate = pool.find(covers);
  const pick = adequate ?? pool[pool.length - 1];
  return { key: pick[0], ramGb: pick[1].ramGb, undersized: !adequate, ha: pick[1].ha === true };
}

/**
 * Translate a workload into one plan's estimate inputs. `cu` is the compute
 * level to bill (average or peak); `hours` the billed hours; `peakRamGb` always
 * sizes fixed instances (they must cover the peak regardless of average load).
 */
function workloadToInputs(plan, { cu, hours, peakRamGb, peakVcpu, metrics }) {
  const usage = { ...metrics };
  const options = {};
  const cuFraction = parseDecimal(String(cu));
  const hoursFraction = parseDecimal(String(hours));
  const model = plan.computeModel ?? "cu_hour";
  let instance;
  let undersized = false;
  let ha = false;
  let comparableCompute = true;
  let computeEstimated = false;

  if (model === "cu_hour" || model === "acu_hour") {
    usage.compute = multiply(cuFraction, hoursFraction); // CU-hours
  } else if (model === "vcpu_ram") {
    usage.compute_vcpu = multiply(cuFraction, hoursFraction);
    usage.compute_ram = multiply(
      multiply(cuFraction, parseDecimal(String(GB_PER_CU))),
      hoursFraction,
    );
  } else if (model === "instance_month" || model === "instance_hour") {
    const chosen = chooseInstance(plan, { peakRamGb, peakVcpu });
    if (chosen) {
      instance = chosen.key;
      undersized = chosen.undersized;
      ha = chosen.ha;
      options.instance = chosen.key;
    }
    if (model === "instance_hour") usage.computeHours = hours;
  } else if (model === "request_unit") {
    // Query-priced. If the plan provides a CU→RU bridge, convert (a rough,
    // compute-only estimate — flagged) so it can be compared; else leave it out.
    if (plan.cuToRuPerHour) {
      const cuHours = multiply(cuFraction, hoursFraction);
      const ruMillionsPerCuHour = parseDecimal(String(plan.cuToRuPerHour / 1e6));
      usage.request_units = multiply(cuHours, ruMillionsPerCuHour); // unit: million RU
      computeEstimated = true;
    } else {
      comparableCompute = false;
    }
  }
  return { usage, options, instance, undersized, ha, comparableCompute, computeEstimated };
}

/**
 * Price one workload across vendors under two scenarios: autoscaled (average CU
 * for autoscalers, active hours for scale-to-zero vendors) and fixed at peak
 * (everyone at peak, 24/7). The gap is the autoscaling + scale-to-zero saving.
 */
export function compareWorkload(workload, { vendors, breakdown, plans } = {}) {
  const selected = vendors?.length ? vendors : Object.keys(VENDORS);
  const peakCu = workload.peakCu;
  const peakRamGb = peakCu * GB_PER_CU;
  const utilization = workload.utilization ?? AUTOSCALE_UTILIZATION;
  const avgCu = workload.avgCu ?? peakCu * utilization;
  const activeHours = workload.activeHours ?? HOURS_PER_MONTH;

  const rows = [];
  for (const vendorKey of selected) {
    const vendor = VENDORS[vendorKey];
    if (!vendor) throw new Error(`unknown vendor: ${vendorKey}`);
    // Explicit `plans` override (per vendor) wins; else the representative
    // COMPARE_PLANS pick; else the first billed plan.
    const planKeys = plans?.[vendorKey] ?? COMPARE_PLANS[vendorKey] ?? [firstBilledPlan(vendor)];
    for (const planKey of planKeys) {
      const plan = vendor.plans[planKey];
      if (!plan) continue;
      const price = (cu, hours) => {
        const inputs = workloadToInputs(plan, {
          cu,
          hours,
          peakRamGb,
          peakVcpu: peakCu, // 1 CU = 1 vCPU; instances must clear the peak vCPU too
          metrics: workload.metrics,
        });
        const result = estimate(vendorKey, planKey, inputs.usage, inputs.options);
        return { ...inputs, result };
      };
      // Autoscalers bill the average CU; others must provision the peak. Scale-
      // to-zero vendors bill only active hours; others bill the whole month.
      const autoscaledCu = vendor.autoscales ? avgCu : peakCu;
      const autoscaledHours = vendor.scalesToZero ? activeHours : HOURS_PER_MONTH;
      const autoscaled = price(autoscaledCu, autoscaledHours);
      const peak = price(peakCu, HOURS_PER_MONTH);
      const autoscaledTotal = autoscaled.result.monthlyTotal; // money object
      const peakTotal = peak.result.monthlyTotal;
      const savingsPct =
        peakTotal.amount > 0
          ? Math.round((1 - autoscaledTotal.amount / peakTotal.amount) * 100)
          : 0;
      rows.push({
        vendor: vendorKey,
        vendorLabel: vendor.label,
        plan: planKey,
        planLabel: plan.label,
        computeModel: plan.computeModel ?? "cu_hour",
        ratesAssumed: plan.ratesAssumed === true,
        autoscales: vendor.autoscales === true,
        scalesToZero: vendor.scalesToZero === true,
        instance: autoscaled.instance ?? null,
        // HA sizing basis, for a like-for-like flag in the UI: instance-priced
        // rows are "ha" (multi-node, e.g. PlanetScale's 3-node production SKU) or
        // "single-node"; autoscaling/serverless rows are null (not node-priced).
        haBasis: autoscaled.instance ? (autoscaled.ha ? "ha" : "single-node") : null,
        undersized: autoscaled.undersized,
        comparableCompute: autoscaled.comparableCompute,
        computeEstimated: autoscaled.computeEstimated === true,
        autoscaledTotal,
        peakTotal,
        savingsPct,
        notes: autoscaled.result.notes,
        // Full itemized estimates (rates, netted quotas, sources) for auditing.
        ...(breakdown ? { estimates: { autoscaled: autoscaled.result, peak: peak.result } } : {}),
      });
    }
  }
  // Cheapest autoscaled first; fully-comparable rows ahead of partial ones.
  rows.sort((a, b) => {
    const partialA = a.comparableCompute ? 0 : 1;
    const partialB = b.comparableCompute ? 0 : 1;
    if (partialA !== partialB) return partialA - partialB;
    return a.autoscaledTotal.amount - b.autoscaledTotal.amount;
  });
  return {
    disposition: "comparison",
    workload: {
      peakCu,
      peakRamGb,
      avgCu,
      utilization,
      avgCuAssumed: workload.avgCu === undefined,
      activeHours,
      alwaysOnHours: HOURS_PER_MONTH,
      metrics: workload.metrics,
    },
    rows,
    exclusions: EXCLUSIONS,
  };
}

/** Convert an instance size (or a RAM figure) to a Neon CU-hours equivalent. */
export function instanceToCu({ vendorKey, planKey, instanceKey, ramGb, activeHours }) {
  let ram = ramGb;
  let label;
  if (ram === undefined) {
    const vendor = VENDORS[vendorKey];
    const plan = vendor?.plans?.[planKey];
    const inst = plan?.instances?.[instanceKey];
    if (!inst || typeof inst.ramGb !== "number") {
      throw new Error("provide --ram-gb, or a --vendor/--plan/--instance with a known RAM size");
    }
    ram = inst.ramGb;
    label = `${vendor.label} ${plan.label} ${inst.label}`;
  }
  const cu = ram / GB_PER_CU;
  const hours = activeHours ?? HOURS_PER_MONTH;
  const neonAt = (planKeyNeon, h) =>
    estimate("neon", planKeyNeon, {
      compute: multiply(parseDecimal(String(cu)), parseDecimal(String(h))),
    }).monthlyTotal;
  return {
    disposition: "instance_to_cu",
    ...(label ? { instance: label } : {}),
    ramGb: ram,
    cuEquivalent: cu, // RAM ÷ 4
    activeHours: hours,
    cuHoursAtActive: cu * hours,
    cuHoursAlwaysOn: cu * HOURS_PER_MONTH,
    neonComputeOnly: {
      launchAtActive: neonAt("launch", hours),
      launchAlwaysOn: neonAt("launch", HOURS_PER_MONTH),
      scaleAtActive: neonAt("scale", hours),
      scaleAlwaysOn: neonAt("scale", HOURS_PER_MONTH),
    },
    note: "CU ≈ RAM ÷ 4 (by memory); an editable approximation. Neon figures are compute-only.",
  };
}

// ---------------------------------------------------------------------------
// sweep — cost curves for a slider
// ---------------------------------------------------------------------------

// Numeric workload fields a slider can drive directly. Anything else is treated
// as a usage metric (storage, egress, request_units, …).
const WORKLOAD_KEYS = new Set(["peakCu", "avgCu", "utilization", "activeHours"]);

/**
 * Vary ONE input across a range and return each vendor's cost curve — the
 * primitive a slider UI charts (x = the swept value, one line per vendor).
 *
 * `over` names the input to vary: a workload field ("peakCu", "avgCu",
 * "utilization", "activeHours") or a usage metric ("storage", "egress", …).
 * Values are `steps + 1` points evenly spaced over [from, to] (inclusive), so
 * both endpoints are sampled. Each series carries per-point numeric totals
 * (Money.amount) for both scenarios, ready to plot without re-running the model.
 */
export function sweep(workload, { over = "peakCu", from = 0, to = 8, steps = 24, vendors } = {}) {
  if (!Number.isInteger(steps) || steps < 1) throw new Error("steps must be an integer >= 1");
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error("from/to must be finite");

  // Usage metrics and workload sizes can't be negative; clamp the sample points
  // so a range dipping below zero neither throws nor leaves the x-axis (values)
  // out of step with the priced y-values.
  const values = [];
  for (let i = 0; i <= steps; i++) values.push(Math.max(0, from + ((to - from) * i) / steps));

  const isMetric = !WORKLOAD_KEYS.has(over);
  const series = new Map(); // "vendor/plan" → series accumulator (insertion order)

  for (const value of values) {
    const point = { ...workload, metrics: { ...(workload.metrics ?? {}) } };
    if (isMetric) point.metrics[over] = value;
    else point[over] = value;

    for (const row of compareWorkload(point, { vendors }).rows) {
      const key = `${row.vendor}/${row.plan}`;
      let s = series.get(key);
      if (!s) {
        s = {
          vendor: row.vendor,
          vendorLabel: row.vendorLabel,
          plan: row.plan,
          planLabel: row.planLabel,
          comparableCompute: row.comparableCompute,
          autoscaled: [],
          peak: [],
        };
        series.set(key, s);
      }
      s.autoscaled.push(row.autoscaledTotal.amount);
      s.peak.push(row.peakTotal.amount);
    }
  }

  return { over, isMetric, from, to, steps, values, series: [...series.values()] };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export { GB_PER_CU, HOURS_PER_MONTH };
