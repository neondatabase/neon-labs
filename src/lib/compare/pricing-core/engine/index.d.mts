// Public type declarations for backend-cost-forecast. Hand-written and kept in
// sync with src/index.mjs — this is the contract web/TS consumers build against.

/** Exact rational used for lossless money math. */
export type Fraction = { n: bigint; d: bigint };

/** Predicted usage: metric name → quantity (decimal string, number, or fraction). */
export type Usage = Record<string, string | number | Fraction>;

/**
 * A money value: cents-rounded number (animate this in a UI), integer cents,
 * formatted display string, and the exact rational as strings (JSON-safe).
 */
export interface Money {
  amount: number;
  amountCents: number;
  display: string;
  exact: { numerator: string; denominator: string };
}

export type PricingStatus = "estimated" | "not_billed" | "unavailable" | "not_metered";

export interface EstimateLine {
  metric: string;
  label: string;
  unit: string | null;
  predicted?: number;
  includedQuota?: number;
  billable?: number;
  ratePerUnit?: string;
  status: PricingStatus;
  amount: Money | null;
}

export interface Estimate {
  disposition: "estimate";
  vendor: string;
  vendorLabel: string;
  plan: string;
  planLabel: string;
  currency: string;
  computeModel: string | null;
  baseMonthlyFee?: Money;
  instance?: string;
  region?: string;
  lines: EstimateLine[];
  monthlyTotal: Money;
  notes: string[];
  exclusions: readonly string[];
  /** Primary source (kept for back-compat); `sources` is the full list. */
  sourceUrl: string;
  sources: string[];
  retrievedAt?: string;
  disclaimer: string;
}

export interface EstimateOptions {
  instance?: string;
  ha?: boolean;
}

export function estimate(
  vendorKey: string,
  planKey: string,
  usage?: Usage,
  options?: EstimateOptions,
): Estimate;

export interface Workload {
  /** Peak CU — sizes the fixed-instance vendors. */
  peakCu: number;
  /** Average active CU for autoscalers; defaults to a fraction of peak. */
  avgCu?: number;
  /** Average-to-peak ratio used when avgCu is omitted (default 0.5). */
  utilization?: number;
  /** Hours per month the workload is active (scale-to-zero lever; default 744). */
  activeHours?: number;
  metrics?: Usage;
}

export interface ComparisonRow {
  vendor: string;
  vendorLabel: string;
  plan: string;
  planLabel: string;
  computeModel: string;
  autoscales: boolean;
  scalesToZero: boolean;
  instance: string | null;
  /** HA sizing basis for instance-priced rows ("ha" | "single-node"); null when not node-priced. */
  haBasis: "ha" | "single-node" | null;
  undersized: boolean;
  comparableCompute: boolean;
  /** true when compute was approximated (e.g. CU-hours → CockroachDB RU). */
  computeEstimated: boolean;
  /** true when the plan's rates are a documented estimate, not published. */
  ratesAssumed: boolean;
  autoscaledTotal: Money;
  peakTotal: Money;
  savingsPct: number;
  notes: string[];
  /** Full itemized estimates for both scenarios; present only with `breakdown`. */
  estimates?: { autoscaled: Estimate; peak: Estimate };
}

export interface Comparison {
  disposition: "comparison";
  workload: {
    peakCu: number;
    peakRamGb: number;
    avgCu: number;
    utilization: number;
    avgCuAssumed: boolean;
    activeHours: number;
    alwaysOnHours: number;
    metrics?: Usage;
  };
  rows: ComparisonRow[];
  exclusions: readonly string[];
}

export function compareWorkload(
  workload: Workload,
  options?: {
    vendors?: string[];
    breakdown?: boolean;
    /** Per-vendor plan keys to price, overriding the default representative pick. */
    plans?: Record<string, string[]>;
  },
): Comparison;

/** One vendor/plan's cost curve across a swept input. Arrays align with `values`. */
export interface SweepSeries {
  vendor: string;
  vendorLabel: string;
  plan: string;
  planLabel: string;
  comparableCompute: boolean;
  /** Autoscaled monthly total (Money.amount) at each swept value. */
  autoscaled: number[];
  /** Fixed-at-peak monthly total at each swept value. */
  peak: number[];
}

export interface Sweep {
  /** The input that was varied. */
  over: string;
  /** true if `over` is a usage metric (else a workload field). */
  isMetric: boolean;
  from: number;
  to: number;
  steps: number;
  /** The `steps + 1` swept values (x-axis), inclusive of both endpoints. */
  values: number[];
  series: SweepSeries[];
}

/**
 * Vary one input across [from, to] and return each vendor's cost curve — the
 * primitive a slider UI charts. `over` is a workload field ("peakCu", "avgCu",
 * "utilization", "activeHours") or a usage metric ("storage", "egress", …).
 */
export function sweep(
  // The swept field (e.g. peakCu) is supplied per-point by the sweep, so the
  // base workload need not include it.
  workload: Partial<Workload>,
  options?: { over?: string; from?: number; to?: number; steps?: number; vendors?: string[] },
): Sweep;

export interface Conversion {
  disposition: "instance_to_cu";
  instance?: string;
  ramGb: number;
  cuEquivalent: number;
  activeHours: number;
  cuHoursAtActive: number;
  cuHoursAlwaysOn: number;
  neonComputeOnly: {
    launchAtActive: Money;
    launchAlwaysOn: Money;
    scaleAtActive: Money;
    scaleAlwaysOn: Money;
  };
  note: string;
}

export function instanceToCu(args: {
  vendorKey?: string;
  planKey?: string;
  instanceKey?: string;
  ramGb?: number;
  activeHours?: number;
}): Conversion;

// --- free tiers ---

export interface FreeTierLine {
  metric: string;
  unit: string;
  predicted: number | null;
  limit: number | null;
  scope: string | null;
  /** true = within limit, false = over, null = not checkable. */
  within: boolean | null;
  overBy: number;
  basis?: string;
  note: string | null;
}

export type FreeKind =
  | "permanent"
  | "expiring_trial"
  | "converting_trial"
  | "credit_trial"
  | "ongoing_credit"
  | "none";

export const FREE_KIND_LABEL: Record<FreeKind, string>;
/** Definitions of on-exceed / on-idle actions (suspend, pause, expire, …). */
export const EXCEED_GLOSSARY: Record<string, string>;

/** One normalized fit fact: workload vs a free-tier limit. */
export interface FitFact {
  dimension: string; // e.g. "compute.ram", "compute.budget", "storage", "request_units"
  /** "consumption" always gates the fit; "capacity" (RAM/vCPU) gates per `gates`. */
  category: "consumption" | "capacity";
  workload: number | null;
  limit: number | null;
  unit: string;
  /** true = within, false = over, null = not evaluable. */
  fits: boolean | null;
  headroom: number | null; // 1 − used/limit when it fits
  basis?: string; // e.g. "GB→GiB" when a unit conversion was applied
  /** Whether this fact fails the headline fit (capacity: vCPU exact, RAM only when gross). */
  gates: boolean;
}

/** Free-tier compute capability (capacity ceiling + optional usage budget). */
export interface FreeCompute {
  model: string; // cu_hour | acu_hour | fixed_instance | ...
  maxVcpu?: number | null;
  maxRamGb?: number | null;
  maxAcu?: number | null;
  sharedCpu?: boolean;
  budget?: { unit: string; amount: string; scope?: string } | null;
  scaleToZeroMinutes?: number;
}

/** Factual durability/eligibility attributes of a free offering. */
export interface FreeDurability {
  requiresCard: boolean | null;
  newCustomerOnly: boolean | null;
  durationDays: number | null;
  graceDays: number | null;
  onIdle: { action: string; afterMinutes?: number; afterDays?: number } | null;
  onExceed: string | null;
  dataLoss: { risk: string; afterDays?: number } | null;
  backups: boolean | null;
  pitr: boolean | null;
}

export interface FreeTierFit {
  vendor: string;
  vendorLabel: string;
  freeKind: FreeKind;
  freeKindLabel: string;
  hasFreeTier: boolean;
  /** Present when the vendor has no free plan. */
  freeNote?: string | null;
  /** "plan" = a $0 plan; "credit" = a recurring usage credit (e.g. CockroachDB). */
  source?: "plan" | "credit";
  plan?: string | null;
  onExceed?: "suspend" | "pause" | "expire" | "bill" | null;
  paidFallback?: string | null;
  note?: string | null;
  compute?: FreeCompute | null;
  durability?: FreeDurability;
  fits?: boolean;
  limiting?: string[];
  /** Capacity (RAM/vCPU) ceilings the peak exceeds — informational, not gated. */
  capacityNotes?: string[];
  lines?: FreeTierLine[];
  fitFacts?: FitFact[];
  /** Paid-fallback cost when the workload exceeds the free tier. */
  wouldCost?: Money | null;
}

export interface FreeComparison {
  disposition: "free_comparison";
  workload: {
    peakCu: number;
    avgCu: number;
    activeHours: number;
    computeCuHours: number;
    peakVcpu: number;
    peakRamGb: number;
    metrics?: Usage;
  };
  rows: FreeTierFit[];
}

export function fitsFreeTier(vendorKey: string, usage?: Record<string, number>): FreeTierFit;
export function compareFreeTiers(
  workload: Workload,
  options?: { vendors?: string[] },
): FreeComparison;

// --- introspection (build UI pickers from these) ---

export interface VendorSummary {
  key: string;
  label: string;
  currency: string;
  sourceUrl: string;
  sources: string[];
  retrievedAt: string | null;
  region: string | null;
  freeKind: FreeKind;
  plans: string[];
}
export interface InstanceSummary {
  key: string;
  label: string;
  ramGb: number | null;
  /** Price value; the unit is `priceUnit` ("month", or "hour" for instance_hour). */
  monthlyPrice: string | null;
  priceUnit: "month" | "hour";
}
export interface PlanSummary {
  key: string;
  label: string;
  billed: boolean;
  computeModel: string | null;
  baseMonthlyFee: string | null;
  ratesAssumed: boolean;
  instances: InstanceSummary[];
  metrics: string[];
}

export function listVendors(): VendorSummary[];
export function getVendor(vendorKey: string): unknown;
export function listPlans(vendorKey: string): PlanSummary[];
export function listInstances(vendorKey: string, planKey: string): InstanceSummary[];
export type MetricCategory = "compute" | "storage" | "egress" | "other";
export function metricCatalog(): Array<{ metric: string; label: string; category: MetricCategory }>;
/** Coarse cost category for a metric (unknown → "other"). */
export function metricCategory(metric: string): MetricCategory;

/** One-call UI bootstrap: every vendor (plans expanded) + metric labels + glossaries. */
export interface Catalog {
  vendors: Array<Omit<VendorSummary, "plans"> & { plans: PlanSummary[] }>;
  metrics: Array<{ metric: string; label: string }>;
  glossaries: {
    billing: Record<string, Record<string, string>>;
    freeKind: Record<string, string>;
    onExceed: Record<string, string>;
  };
}
export function catalog(): Catalog;

/** Returns human-readable data problems; empty array when valid. */
export function validateVendors(vendors?: Record<string, unknown>): string[];

export const VENDORS: Record<string, unknown>;
export const EXCLUSIONS: readonly string[];
export const METRIC_LABELS: Readonly<Record<string, string>>;
export const HOURS_PER_MONTH: number;
export const GB_PER_CU: number;

// --- billing model ---

export interface Billing {
  computeUnit: string;
  granularity: string;
  scaleToZero: boolean;
  autoscaling: boolean;
  storage: string;
  storageUnit: string;
  minimum: string;
  costDriver: string;
}
export interface BillingDiff {
  field: string;
  vendor: string | boolean | null;
  neon: string | boolean | null;
}
export interface BillingComparison {
  vendor: string;
  vendorLabel: string;
  billing: Billing;
  neonBilling: Billing;
  diffs: BillingDiff[];
}
export function billingVsNeon(vendorKey: string): BillingComparison;
export const BILLING_GLOSSARY: Record<string, Record<string, string>>;

// --- feature comparison ---

export interface FeatureDimension {
  key: string;
  label: string;
  category: string;
}
export interface FeatureCell {
  /** Factual description of the capability. */
  value: string;
  /**
   * Capability state: true (yes), false (no), "partial" (a primitive exists but
   * not as a managed product, e.g. pg_cron), or null when the value is a
   * quantity/description rather than a yes/no.
   */
  supported: boolean | "partial" | null;
}
export interface FeatureVendor {
  vendor: string;
  /** The plan whose overrides were applied, or null for the vendor baseline. */
  plan: string | null;
  hasData: boolean;
  source: string | null;
  retrievedAt: string | null;
  /** dimension key → cell, or null when unresearched for this vendor. */
  cells: Record<string, FeatureCell | null>;
}
export interface FeatureComparison {
  disposition: "feature_comparison";
  dimensions: FeatureDimension[];
  vendors: FeatureVendor[];
}
/** Each selection is a vendor key (baseline) or { vendor, plan } (with overrides). */
export type FeatureSelection = string | { vendor: string; plan?: string };
export function compareFeatures(selections?: FeatureSelection[]): FeatureComparison;
export const FEATURE_DIMENSIONS: readonly FeatureDimension[];
export const FEATURES: Record<
  string,
  {
    source: string;
    retrievedAt: string;
    features: Record<string, FeatureCell>;
    plans?: Record<string, { features: Record<string, FeatureCell> }>;
  }
>;

// --- exact-money helpers for advanced consumers ---
export function parseDecimal(value: string | number): Fraction;
export function toMoney(fraction: Fraction): string;
export function money(fraction: Fraction): Money;
