// Pure data-shaping for the /compare tables — extracted from the page so it's unit
// testable (see tables.test.mjs) and the page stays presentational. No JSX here.

/** A per-unit rate as "$0.106/CU-hr" / "$0.35/GB-mo", or null if the plan has none. */
export function fmtRate(r) {
  if (!r?.rate) return null;
  const unit = r.unit === "GB-month" ? "GB-mo" : r.unit === "CU-hour" ? "CU-hr" : r.unit;
  return `$${r.rate}/${unit}`;
}

const scopePhrase = (s) => (s === "per_project" ? " (per project)" : s === "per_org" ? " (per org)" : "");

/** "500 GB included (per project)" / "8 GB included" / null when nothing is included. */
export function inclLabel(r) {
  return r?.includedQuota && r.includedQuota !== "0" ? `${r.includedQuota} GB included${scopePhrase(r.scope)}` : null;
}

/** Supabase-style instance price span, e.g. "$10–$1,870/mo", or null. */
export function priceRange(plan) {
  const prices = Object.values(plan.instances ?? {}).map((i) => Number(i.monthlyPrice)).filter((n) => n > 0);
  if (!prices.length) return null;
  return `$${Math.min(...prices).toLocaleString()}–$${Math.max(...prices).toLocaleString()}/mo`;
}

/** The paid, real-rate tiers to show as columns (Neon Launch/Scale, Supabase Pro/Team). */
export function rateColumns(cards) {
  return cards.flatMap((v) =>
    v.plans.filter((p) => p.billed && !p.ratesAssumed).map((p) => ({ vendorLabel: v.label, plan: p })),
  );
}

/**
 * A fully-resolved rate table: { columns:[{vendorLabel, plan, planLabel}],
 * rows:[{label, cells:[{value, sub}]}] } — every cell is a display string, so the
 * page just maps it to JSX (and tests can assert exact values).
 */
export function buildRateTable(cards) {
  const cols = rateColumns(cards);
  const defs = [
    { label: "Base fee", value: (p) => (p.baseMonthlyFee && p.baseMonthlyFee !== "0" ? `$${p.baseMonthlyFee}/mo` : "$0") },
    { label: "Compute", value: (p) => fmtRate(p.rates.compute) ?? "by instance", sub: (p) => (fmtRate(p.rates.compute) ? "per usage" : priceRange(p)) },
    { label: "DB storage", value: (p) => fmtRate(p.rates.storage) ?? "—", sub: (p) => inclLabel(p.rates.storage) },
    { label: "Egress", value: (p) => fmtRate(p.rates.egress) ?? "—", sub: (p) => inclLabel(p.rates.egress) },
  ];
  return {
    columns: cols.map((c) => ({ vendorLabel: c.vendorLabel, plan: c.plan.plan, planLabel: c.plan.label })),
    rows: defs.map((d) => ({ label: d.label, cells: cols.map((c) => ({ value: d.value(c.plan), sub: d.sub ? d.sub(c.plan) : null })) })),
  };
}

/** Feature dimensions grouped by category, preserving order: [{category, dims}]. */
export function groupDimensions(dimensions) {
  const groups = [];
  for (const d of dimensions) {
    const g = groups.find((x) => x.category === d.category);
    if (g) g.dims.push(d);
    else groups.push({ category: d.category, dims: [d] });
  }
  return groups;
}
