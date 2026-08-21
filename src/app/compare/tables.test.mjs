// Unit tests for the /compare table shaping. Run: npm test (node --test).
// Exercises the real vendored pricing/feature data so a data or formatting
// regression (rates, scope, included quotas, grouping) fails here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRateTable, groupDimensions, fmtRate, inclLabel, priceRange } from "./tables.mjs";
import { featuresFor } from "../../lib/compare/compare.mjs";
import { rateCard as rateCardCore } from "../../lib/compare/pricing-core/index.mjs";

test("fmtRate: formats per-unit rates and abbreviates units", () => {
  assert.equal(fmtRate({ rate: "0.106", unit: "CU-hour" }), "$0.106/CU-hr");
  assert.equal(fmtRate({ rate: "0.35", unit: "GB-month" }), "$0.35/GB-mo");
  assert.equal(fmtRate({ rate: null }), null);
  assert.equal(fmtRate(undefined), null);
});

test("inclLabel: spells out included quota with scope", () => {
  assert.equal(inclLabel({ includedQuota: "500", scope: "per_project" }), "500 GB included (per project)");
  assert.equal(inclLabel({ includedQuota: "250", scope: "per_org" }), "250 GB included (per org)");
  assert.equal(inclLabel({ includedQuota: "8" }), "8 GB included"); // no scope
  assert.equal(inclLabel({ includedQuota: "0" }), null);
});

test("priceRange: spans a vendor's instance grid", () => {
  const supa = rateCardCore("supabase")[0];
  const pro = supa.plans.find((p) => p.plan === "pro");
  assert.match(priceRange(pro), /^\$10–\$1,870\/mo$/);
  assert.equal(priceRange({ instances: {} }), null);
});

test("buildRateTable: 4 paid columns, aligned rows, correct cells", () => {
  const t = buildRateTable(rateCardCore());
  assert.deepEqual(t.columns.map((c) => `${c.vendorLabel} ${c.planLabel}`), ["Neon Launch", "Neon Scale", "Supabase Pro", "Supabase Team"]);
  const byLabel = Object.fromEntries(t.rows.map((r) => [r.label, r.cells]));
  // aligned rows present
  assert.deepEqual(t.rows.map((r) => r.label), ["Base fee", "Compute", "DB storage", "Egress"]);
  // Base fee: Neon $0, Supabase Pro $25 / Team $599
  assert.deepEqual(byLabel["Base fee"].map((c) => c.value), ["$0", "$0", "$25/mo", "$599/mo"]);
  // Compute: Neon per-CU-hr; Supabase "by instance" with a price-range sub
  assert.equal(byLabel["Compute"][0].value, "$0.106/CU-hr");
  assert.equal(byLabel["Compute"][2].value, "by instance");
  assert.match(byLabel["Compute"][2].sub, /\$10–\$1,870\/mo/);
  // Egress scope: Neon per project, Supabase per org
  assert.equal(byLabel["Egress"][0].sub, "500 GB included (per project)");
  assert.equal(byLabel["Egress"][2].sub, "250 GB included (per org)");
  // DB storage: Supabase 8 GB included, no scope
  assert.equal(byLabel["DB storage"][2].sub, "8 GB included");
});

test("groupDimensions: groups by category, preserves every dimension", () => {
  const matrix = featuresFor();
  const groups = groupDimensions(matrix.dimensions);
  assert.ok(groups.length >= 5, "several categories");
  assert.equal(groups.reduce((n, g) => n + g.dims.length, 0), matrix.dimensions.length);
  assert.equal(groups[0].category, matrix.dimensions[0].category);
});
