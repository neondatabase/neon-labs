// Vendor feature/capability data — a separate facet from pricing. Factual, no
// marketing. Features can vary by PLAN, so each vendor has a baseline (`features`,
// the paid default) plus optional per-plan overrides (`plans[planKey].features`)
// that add or replace cells (e.g. Free has fewer capabilities and smaller quotas).
// Seeded from the Neon vs Supabase guide (https://neon.com/guides/neon-vs-supabase,
// verified 2026-08-13); other vendors are unpopulated (null) until researched.
//
// Cell shape (after compareFeatures normalization): `{ supported, description }`.
//   supported: true = offered, false = not offered, "partial" = partially offered,
//              null = unknown / not researched. It answers ONLY "is it offered?" —
//              never "this is a quantity" (that's what the dimension's `kind` is for).
//   description: the human-readable specifics/magnitude (may be null).
// A dimension's `kind` says how to READ the cell:
//   "capability" → a yes/no feature; render supported as ✓/✗ with description as detail.
//   "metric"     → a quantity/tier (MAU count, projects included, support tier); the
//                  description IS the point — render it, not a checkmark. `supported`
//                  on a metric only distinguishes offered (true) from absent (false).

import { deepFreeze } from "./util.mjs";

/** Ordered feature dimensions (matrix rows), grouped by category. `kind` is
 *  "capability" (yes/no) or "metric" (a quantity/tier — read the description). */
export const FEATURE_DIMENSIONS = deepFreeze([
  { key: "scaleToZero", label: "Scale to zero", category: "Database", kind: "capability" },
  { key: "autoscaling", label: "Autoscaling compute", category: "Database", kind: "capability" },
  { key: "branching", label: "Branching", category: "Database", kind: "capability" },
  { key: "readReplicas", label: "Read replicas", category: "Database", kind: "capability" },
  { key: "pooling", label: "Connection pooling", category: "Database", kind: "capability" },
  { key: "auth", label: "Managed auth", category: "Auth", kind: "capability" },
  { key: "mau", label: "Included MAU", category: "Auth", kind: "metric" },
  { key: "restApi", label: "REST data API", category: "APIs", kind: "capability" },
  { key: "graphql", label: "GraphQL API", category: "APIs", kind: "capability" },
  { key: "functions", label: "Serverless functions", category: "Functions", kind: "capability" },
  { key: "objectStorage", label: "Object storage", category: "Storage", kind: "capability" },
  { key: "cdn", label: "Storage CDN / image optimization", category: "Storage", kind: "capability" },
  { key: "aiGateway", label: "AI gateway", category: "AI", kind: "capability" },
  { key: "pgvector", label: "Vector (pgvector)", category: "AI", kind: "capability" },
  { key: "realtime", label: "Realtime (managed)", category: "Realtime & jobs", kind: "capability" },
  { key: "cronQueues", label: "Managed cron / queues", category: "Realtime & jobs", kind: "capability" },
  { key: "projects", label: "Projects included", category: "Platform", kind: "metric" },
  { key: "recovery", label: "Recovery (PITR / backups)", category: "Ops & compliance", kind: "capability" },
  { key: "compliance", label: "Compliance", category: "Ops & compliance", kind: "capability" },
  { key: "accessControls", label: "SSO & access controls", category: "Ops & compliance", kind: "capability" },
  { key: "support", label: "Support & SLA", category: "Ops & compliance", kind: "metric" },
]);

// The neon-vs-supabase guide seeded this data, but it's a SUMMARY, not the source of
// truth — the vendors' own pricing/plan/feature pages are. `sources` lists the SoT
// pages first, with the comparison guide last as the (secondary) seed.
const NEON_VS_SUPABASE = "https://neon.com/guides/neon-vs-supabase";
const NEON_FEATURE_SOURCES = [
  "https://neon.com/pricing",
  "https://neon.com/docs/introduction/plans",
  NEON_VS_SUPABASE,
];
const SUPABASE_FEATURE_SOURCES = [
  "https://supabase.com/pricing",
  "https://supabase.com/features",
  NEON_VS_SUPABASE,
];

// `features` is the vendor's paid baseline; `plans[key].features` overrides
// individual cells for that plan (fewer capabilities / different quotas).
export const FEATURES = deepFreeze({
  neon: {
    sources: NEON_FEATURE_SOURCES,
    retrievedAt: "2026-08-13",
    features: {
      scaleToZero: {
        supported: true,
        description: "Yes — idle compute suspends, resumes in ~sub-second",
      },
      autoscaling: { supported: true, description: "0.25–16 CU autoscaling" },
      branching: {
        supported: true,
        description: "Copy-on-write clone of the DB + services with production data, in seconds",
      },
      readReplicas: {
        supported: true,
        description: "Extra compute on the same storage (no data duplication)",
      },
      pooling: { supported: true, description: "PgBouncer, up to 10,000 pooled connections per compute" },
      auth: { supported: true, description: "Managed Better Auth; auth state branches with the DB" },
      mau: { supported: true, description: "1,000,000 (paid plans)" },
      restApi: { supported: true, description: "PostgREST-compatible REST" },
      graphql: { supported: false, description: "Not offered" },
      functions: {
        supported: true,
        description: "Node.js 24, long-running (15 min, 2 GiB), deployed onto a branch",
      },
      objectStorage: { supported: true, description: "S3-compatible, isolated namespace per branch" },
      cdn: { supported: false, description: "No built-in CDN / image optimization" },
      aiGateway: { supported: true, description: "AI Gateway — one credential across model providers" },
      pgvector: { supported: true, description: "pgvector" },
      realtime: { supported: false, description: "Not managed; Functions can host WebSocket backends" },
      cronQueues: {
        supported: "partial",
        description: "pg_cron (runs only while compute is active); no managed jobs product yet",
      },
      projects: { supported: true, description: "100 (idle projects cost nothing)" },
      // Scale/Team guide (verified 2026-08-13); baseline = Scale-level.
      recovery: {
        supported: true,
        description: "Instant restore to any point up to 30 days; scheduled snapshots",
      },
      compliance: {
        supported: true,
        description: "SOC 2, SOC 3, ISO 27001, ISO 27701, GDPR, CCPA; HIPAA at additional charge",
      },
      accessControls: {
        supported: true,
        description: "IP Allow, PrivateLink private networking, metrics/logs export (Datadog/OTel)",
      },
      support: {
        supported: true,
        description: "Uptime SLA; Standard support, Business/Production tiers above",
      },
    },
    plans: {
      // Neon vs Supabase free-plan guide (verified 2026-08-13).
      free: {
        features: {
          autoscaling: { supported: true, description: "0.25–2 CU (≈8 GB RAM); 100 CU-hr/mo budget" },
          mau: { supported: true, description: "60,000" },
          functions: { supported: true, description: "Included, with usage limits" },
          objectStorage: { supported: true, description: "Included, with usage limits" },
          branching: { supported: true, description: "10 branches per project (copy-on-write)" },
          aiGateway: { supported: false, description: "Not available on Free" },
          recovery: {
            supported: true,
            description: "Instant restore, 6-hour window (1 GB); 1 manual snapshot",
          },
          compliance: { supported: false, description: "Not covered on Free" },
          accessControls: { supported: false, description: "Not on Free" },
          support: { supported: true, description: "Community" },
        },
      },
      // Launch is the entry paid plan: lower PITR window and support than the
      // Scale-level baseline (neon.com/pricing + the Launch-vs-Pro guide,
      // verified 2026-08-19).
      launch: {
        features: {
          recovery: {
            supported: true,
            description: "Instant restore up to 7 days ($0.20/GB-month of history); 100 manual snapshots",
          },
          support: { supported: true, description: "Billing support; no uptime SLA" },
        },
      },
      scale: {
        features: {
          autoscaling: { supported: true, description: "0.25–16 CU autoscaling; fixed sizes to 56 CU" },
          projects: { supported: true, description: "1,000 (more on request)" },
          recovery: {
            supported: true,
            description: "Instant restore to any point up to 30 days; scheduled snapshots",
          },
          support: {
            supported: true,
            description: "Standard support + uptime SLA (Business/Production tiers above)",
          },
        },
      },
    },
  },
  supabase: {
    sources: SUPABASE_FEATURE_SOURCES,
    retrievedAt: "2026-08-13",
    features: {
      scaleToZero: { supported: false, description: "No — fixed instance billed hourly" },
      autoscaling: {
        supported: false,
        description: "Manual resize (Nano–16XL), usually < 2 min downtime",
      },
      branching: {
        supported: true,
        description:
          "Separate env rebuilt from migrations/seed; no production data by default; billed per hour",
      },
      readReplicas: {
        supported: true,
        description: "Separate instances kept in sync by physical replication",
      },
      pooling: { supported: true, description: "Supavisor, up to 12,000 clients on 16XL" },
      auth: {
        supported: true,
        description: "Supabase Auth; passwords, social, SSO, MFA; RLS-based access",
      },
      mau: { supported: true, description: "100,000 (Pro), then $0.00325/MAU" },
      restApi: { supported: true, description: "PostgREST REST" },
      graphql: { supported: true, description: "GraphQL via pg_graphql" },
      functions: { supported: true, description: "Deno edge functions, short handlers (256 MB, 2s CPU)" },
      objectStorage: { supported: true, description: "S3-compatible project buckets" },
      cdn: { supported: true, description: "CDN, image optimization, resumable uploads" },
      aiGateway: { supported: false, description: "Not offered (pgvector + models from edge functions)" },
      pgvector: { supported: true, description: "pgvector" },
      realtime: { supported: true, description: "Managed Broadcast, Presence, Postgres Changes" },
      cronQueues: { supported: true, description: "Managed Cron and Queues (built on pg_cron and pgmq)" },
      projects: { supported: true, description: "1 included, then $10/mo each additional" },
      // Scale/Team guide (verified 2026-08-13); baseline = Team-level.
      recovery: {
        supported: true,
        description: "PITR is a paid add-on (7/14/28-day tiers, $100/mo per 7 days); backup retention grows on Team",
      },
      compliance: { supported: true, description: "SOC 2 and ISO 27001; HIPAA as a paid add-on" },
      accessControls: {
        supported: true,
        description: "Dashboard SSO, network restrictions, log drains, PrivateLink (Team/Enterprise)",
      },
      support: {
        supported: true,
        description: "Priority email support with SLAs; uptime SLA on Enterprise",
      },
    },
    plans: {
      // Neon vs Supabase free-plan guide (verified 2026-08-13).
      free: {
        features: {
          autoscaling: {
            supported: false,
            description: "Fixed Nano (shared CPU, up to 0.5 GB RAM), no resize",
          },
          readReplicas: { supported: false, description: "Not on Free" },
          branching: {
            supported: false,
            description: "Not on Free (branches are paid per-hour environments)",
          },
          mau: { supported: true, description: "50,000" },
          functions: { supported: true, description: "500,000 edge function invocations" },
          objectStorage: { supported: true, description: "1 GB" },
          realtime: { supported: true, description: "2M messages, 200 concurrent connections" },
          projects: { supported: true, description: "2" },
          recovery: { supported: false, description: "No backups/PITR on Free (manual dumps)" },
          compliance: { supported: false, description: "Not covered on Free" },
          accessControls: { supported: false, description: "Not on Free" },
          support: { supported: true, description: "Community" },
        },
      },
      // Pro is capacity-similar to Team; Team adds compliance, SSO, support.
      // PITR on Pro is a 7-day add-on (Launch-vs-Pro guide, verified 2026-08-19);
      // the baseline's longer window is Team-level.
      pro: {
        features: {
          compliance: { supported: true, description: "SOC 2 (Team adds ISO 27001 + HIPAA add-on)" },
          accessControls: { supported: false, description: "No dashboard SSO (Team/Enterprise only)" },
          support: { supported: true, description: "Email support (Team adds priority + SLAs)" },
          recovery: {
            supported: true,
            description: "7-day PITR add-on ($100/mo per 7 days); daily backups retained 7 days",
          },
        },
      },
    },
  },
});

/** Normalize a raw cell to the canonical `{ supported, description }`.
 *  Missing/no-data → supported:null (unknown). Reads `description`, falling back to a
 *  legacy `value` so not-yet-migrated vendor data still surfaces. */
function normalizeCell(raw) {
  if (raw == null) return { supported: null, description: null };
  if (typeof raw === "object") {
    return { supported: raw.supported ?? null, description: raw.description ?? raw.value ?? null };
  }
  return { supported: raw, description: null }; // defensive: a bare boolean/string
}

/**
 * Feature matrix across the given selections. Each selection is a vendor key
 * (uses the baseline) or `{ vendor, plan }` (baseline with that plan's overrides
 * applied). Every cell is normalized to `{ supported, description }`; supported is
 * null when we have no researched data for that vendor/dimension. Read the
 * dimension's `kind` to know whether a cell is a yes/no capability or a metric.
 */
export function compareFeatures(selections) {
  const list = (selections?.length ? selections : Object.keys(FEATURES)).map((s) =>
    typeof s === "string" ? { vendor: s } : s,
  );
  return {
    disposition: "feature_comparison",
    dimensions: FEATURE_DIMENSIONS,
    vendors: list.map(({ vendor, plan }) => {
      const entry = FEATURES[vendor];
      const overrides = plan ? (entry?.plans?.[plan]?.features ?? {}) : {};
      return {
        vendor,
        plan: plan ?? null,
        hasData: Boolean(entry),
        sources: entry?.sources ?? [],
        retrievedAt: entry?.retrievedAt ?? null,
        cells: Object.fromEntries(
          FEATURE_DIMENSIONS.map((d) => [d.key, normalizeCell(overrides[d.key] ?? entry?.features?.[d.key])]),
        ),
      };
    }),
  };
}
