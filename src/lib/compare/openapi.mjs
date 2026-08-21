// OpenAPI 3.1 description of the cost/comparison API. Generated from a `basePath` so
// the SAME document is correct on every surface — the standalone serves it under
// "/api", the labs advisor under "/api/compare" — WITHOUT the brittle string-replace
// the guide route uses. Shared enums (vendors, Supabase tiers, activity patterns)
// come from the same modules the handlers use, so the spec can't drift from them.
import { LISTED_VENDORS } from "./pricing-core/index.mjs";
import { SUPABASE_INSTANCE_KEYS, ACTIVITY_PATTERNS } from "./extract-supabase.mjs";

const CONFIDENCE = ["high", "medium", "low", "assumed"];

/**
 * Build the OpenAPI 3.1 document.
 * @param {object} [opts]
 * @param {string} [opts.basePath="/api"]  path prefix the JSON endpoints live under
 * @param {string} [opts.guidePath]        where the markdown playbook is served
 * @param {string} [opts.version="0.1.0"]
 */
export function openapiSpec({ basePath = "/api", guidePath, version = "0.1.0" } = {}) {
  const p = (s) => `${basePath}${s}`;
  const guide = guidePath ?? "/guide/supabase-to-neon";

  const workloadField = {
    description: "A workload field: a bare number, or an object carrying confidence/provenance.",
    oneOf: [
      { type: "number", minimum: 0 },
      {
        type: "object",
        required: ["value"],
        properties: {
          value: { type: "number", minimum: 0 },
          confidence: { type: "string", enum: CONFIDENCE },
          source: { type: "string", description: "measured | inferred | default | user" },
        },
      },
    ],
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "Neon cost & comparison API",
      version,
      summary: "Estimate Neon cost, price known vendor plans, and compare Neon vs Neon / vs competitors (features + rates).",
      description:
        "Agent-facing and public (no authentication). One estimate endpoint routes on the payload shape; plus a " +
        "machine-readable rate card, a capability matrix, a discovery catalog, and a served Supabase→Neon playbook. " +
        "Estimates, not invoices — every figure carries `sources[]` + `retrievedAt`. For LLM agents, `GET /` " +
        `(llms.txt) and \`GET ${p("/catalog")}\` are the quickstart; this document is the formal contract.`,
      license: { name: "Proprietary (Neon internal)", identifier: "LicenseRef-Neon-Internal" },
    },
    servers: [{ url: "/", description: "Same origin as this document" }],
    security: [], // public API — no authentication required
    paths: {
      [p("/estimate")]: {
        post: {
          operationId: "estimate",
          summary: "What would this cost? — routes on the payload shape",
          description:
            "Send whatever you have. Inferred inputs (`supabase`/`workload`) also return an advisory `validation` " +
            "and, for `supabase`, a head-to-head `comparison`. `vendor` prices a KNOWN plan directly (no validation).",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/SupabaseInput" },
                    { $ref: "#/components/schemas/VendorInput" },
                    { $ref: "#/components/schemas/WorkloadInput" },
                    { $ref: "#/components/schemas/CuHoursInput" },
                    { $ref: "#/components/schemas/ProfileInput" },
                    { $ref: "#/components/schemas/SnapshotInput" },
                  ],
                },
                examples: {
                  supabase: { summary: "Not on Neon yet — Supabase signals", value: { supabase: { instance: "large", dbSizeGb: 8, avgCpuPct: 15, activity: "always_on", egressGb: 40 } } },
                  knownVendor: { summary: "Price a known vendor plan directly", value: { vendor: "supabase", plan: "pro", instance: "large", storageGb: 8, egressGb: 40 } },
                  measured: { summary: "Already on Neon — measured usage", value: { cuHours: 92, storageGb: 0.4, egressGb: 3 } },
                },
              },
            },
          },
          responses: {
            200: {
              // anyOf, not oneOf: EstimateResult is open (additionalProperties), so a
              // DirectPrice body also validates against it — oneOf would (wrongly) reject.
              description: "An estimate (inferred/measured inputs) or a direct price (`vendor` input).",
              content: { "application/json": { schema: { anyOf: [{ $ref: "#/components/schemas/EstimateResult" }, { $ref: "#/components/schemas/DirectPrice" }] } } },
            },
            400: { $ref: "#/components/responses/BadRequest" },
          },
        },
      },
      [p("/pricing")]: {
        get: {
          operationId: "pricing",
          summary: "Machine-readable rate card (rates, instance grids, sources)",
          parameters: [{ $ref: "#/components/parameters/VendorScope" }],
          responses: {
            200: { description: "Rate card.", content: { "application/json": { schema: { $ref: "#/components/schemas/RateCard" } } } },
            404: { $ref: "#/components/responses/BadRequest" },
          },
        },
      },
      [p("/features")]: {
        get: {
          operationId: "features",
          summary: "Capability matrix (features only; no input sent)",
          description: "Scope with `vendor` (`neon` = Free→Launch→Scale ladder; a competitor = Neon vs it; omit = Neon vs all) and optional `plans`.",
          parameters: [
            { $ref: "#/components/parameters/VendorScope" },
            { name: "tier", in: "query", required: false, schema: { type: "string" }, description: "Compare the same tier across every vendor that has it, e.g. `free` → Neon Free vs Supabase Free." },
            { name: "plans", in: "query", required: false, schema: { type: "string" }, description: "Comma-separated plan keys of one vendor to show exactly (e.g. `free,launch`)." },
          ],
          responses: {
            200: { description: "Feature matrix.", content: { "application/json": { schema: { $ref: "#/components/schemas/FeatureMatrix" } } } },
            400: { $ref: "#/components/responses/BadRequest" },
          },
        },
      },
      [p("/catalog")]: {
        get: { operationId: "catalog", summary: "Discovery: vendors/plans + request shapes + pointers", responses: { 200: { description: "Catalog.", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } } } },
      },
      [p("/openapi.json")]: {
        get: { operationId: "openapi", summary: "This OpenAPI 3.1 document", responses: { 200: { description: "The spec.", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } } } },
      },
      [guide]: {
        get: { operationId: "guide", summary: "The Supabase→Neon extraction + cost + migration playbook (markdown)", responses: { 200: { description: "Playbook.", content: { "text/markdown": { schema: { type: "string" } } } } } },
      },
    },
    components: {
      parameters: {
        VendorScope: { name: "vendor", in: "query", required: false, schema: { type: "string", enum: LISTED_VENDORS }, description: "Scope to one vendor; omit for the default." },
      },
      responses: {
        BadRequest: { description: "Invalid request — the `error` message names the problem and valid options.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
      schemas: {
        Error: { type: "object", required: ["error"], properties: { error: { type: "string" } } },
        WorkloadField: workloadField,
        Workload: {
          type: "object",
          description: "The normalized workload the estimator prices.",
          properties: Object.fromEntries(
            ["peakCu", "avgCu", "activeHours", "storageGb", "egressGb"].map((k) => [k, { $ref: "#/components/schemas/WorkloadField" }]),
          ),
        },
        SupabaseInput: {
          type: "object", required: ["supabase"],
          properties: { supabase: { type: "object", required: ["instance"], properties: {
            instance: { type: "string", enum: SUPABASE_INSTANCE_KEYS },
            dbSizeGb: { type: "number", description: "pg_database_size / 1e9" },
            avgCpuPct: { type: "number", description: "avg CPU % (optional; omit → 50% of peak, low confidence)" },
            activity: { type: "string", enum: ACTIVITY_PATTERNS },
            egressGb: { type: "number", description: "monthly egress (optional; ASK if unknown)" },
          } } },
        },
        VendorInput: {
          type: "object", required: ["vendor"],
          description: "Price a KNOWN vendor plan directly (no extraction, no validation).",
          properties: {
            vendor: { type: "string", enum: LISTED_VENDORS },
            plan: { type: "string", description: "Defaults to the vendor's entry paid tier." },
            instance: { type: "string", description: "Instance/size key (per-instance vendors)." },
            storageGb: { type: "number" }, egressGb: { type: "number" },
            computeCuHours: { type: "number", description: "Neon's CU-hour compute model." },
          },
        },
        WorkloadInput: { type: "object", required: ["workload"], properties: { workload: { $ref: "#/components/schemas/Workload" } } },
        CuHoursInput: {
          type: "object", required: ["cuHours"],
          description: "Measured Neon usage (precise; no validation).",
          properties: { cuHours: { type: "number", minimum: 0 }, storageGb: { type: "number" }, egressGb: { type: "number" }, peakCu: { type: "number" } },
        },
        ProfileInput: {
          type: "object", required: ["profile", "instance"],
          properties: { profile: { type: "array", items: { type: "number" }, description: "Hourly CPU% series." }, instance: { type: "object", properties: { vcpu: { type: "number" }, maxCu: { type: "number" } }, required: ["vcpu"] }, storageGb: { type: "number" }, egressGb: { type: "number" } },
        },
        SnapshotInput: { type: "object", required: ["snapshot"], properties: { snapshot: { type: "object", additionalProperties: true, description: "A neon-usage current_period_snapshot." } } },
        PlanCost: {
          type: "object",
          properties: { plan: { type: "string" }, monthlyTotal: { type: "string", description: "Display, e.g. \"26.46\"" }, amount: { type: "number" }, lines: { type: "array", items: { type: "object", properties: { label: { type: "string" }, amount: { type: "string" } } } } },
        },
        Recommendation: { type: "object", properties: { plan: { type: "string" }, monthlyTotal: { type: "string" }, note: { type: "string" } } },
        EstimateResult: {
          type: "object",
          description: "Estimate for an inferred/measured workload. Rich; key fields documented, others may appear.",
          additionalProperties: true,
          properties: {
            useCase: { type: "string" },
            recommendation: { $ref: "#/components/schemas/Recommendation" },
            assumptions: { type: "array", items: { type: "string" } },
            launch: { $ref: "#/components/schemas/PlanCost" },
            scale: { $ref: "#/components/schemas/PlanCost" },
            range: { type: "object", additionalProperties: true },
            withoutAutoscaling: { type: "object", additionalProperties: true, description: "Fixed-compute (peak × 744h) baseline — the gap vs the estimate is the autoscaling win." },
            comparison: { $ref: "#/components/schemas/Comparison" },
            validation: { $ref: "#/components/schemas/Validation" },
          },
        },
        Validation: { type: "object", description: "Advisory plausibility check (never alters price).", properties: { verdict: { type: "string", enum: ["ok", "suspect"] }, warnings: { type: "array", items: { type: "string" } }, checkedBy: { type: "string", enum: ["llm", "rules"] } } },
        Comparison: {
          type: "object", description: "Head-to-head vs a competitor (supabase path).",
          properties: {
            cost: { type: "object", properties: {
              competitor: { $ref: "#/components/schemas/DirectPrice" },
              neonLaunch: { type: "object", properties: { monthlyTotal: { type: "string" }, amount: { type: "number" } } },
              neonScale: { type: "object", properties: { monthlyTotal: { type: "string" }, amount: { type: "number" } } },
              deltaVsLaunch: { type: "number", description: "How much more the competitor costs vs Neon Launch." },
              note: { type: "string" },
            } },
            features: { type: "object", properties: { dimensions: { type: "integer" }, neonOnly: { type: "array", items: { type: "string" } }, competitorOnly: { type: "array", items: { type: "string" } } } },
          },
        },
        DirectPrice: {
          type: "object",
          properties: { vendor: { type: "string" }, plan: { type: "string" }, instance: { type: ["string", "null"] }, monthlyTotal: { type: ["string", "null"] }, amount: { type: ["number", "null"] }, lines: { type: "array", items: { type: "object", properties: { label: { type: "string" }, amount: { type: "string" } } } }, sources: { type: "array", items: { type: "string", format: "uri" } }, retrievedAt: { type: "string" } },
        },
        RateCard: {
          type: "object",
          properties: { note: { type: "string" }, vendors: { type: "array", items: {
            type: "object",
            properties: {
              vendor: { type: "string" }, label: { type: "string" }, currency: { type: "string" },
              billing: { type: "object", additionalProperties: true }, sources: { type: "array", items: { type: "string", format: "uri" } }, retrievedAt: { type: "string" },
              plans: { type: "array", items: { type: "object", properties: {
                plan: { type: "string" }, label: { type: "string" }, billed: { type: "boolean" }, ratesAssumed: { type: "boolean" },
                computeModel: { type: ["string", "null"] }, baseMonthlyFee: { type: ["string", "null"] }, computeCreditMonthly: { type: ["string", "null"] },
                rates: { type: "object", additionalProperties: { type: "object", properties: { label: { type: "string" }, category: { type: "string" }, unit: { type: ["string", "null"] }, rate: { type: ["string", "null"] }, includedQuota: { type: ["string", "null"] }, scope: { type: "string" } } } },
                instances: { type: "object", additionalProperties: { type: "object", properties: { label: { type: "string" }, ramGb: { type: ["number", "null"] }, monthlyPrice: { type: ["string", "null"] } } } },
              } } },
            },
          } } },
        },
        FeatureMatrix: {
          type: "object",
          properties: {
            disposition: { type: "string" },
            dimensions: { type: "array", items: { type: "object", properties: { key: { type: "string" }, label: { type: "string" }, category: { type: "string" }, kind: { type: "string", enum: ["capability", "metric"] } } } },
            vendors: { type: "array", items: { type: "object", properties: {
              vendor: { type: "string" }, plan: { type: ["string", "null"] }, hasData: { type: "boolean" },
              sources: { type: "array", items: { type: "string", format: "uri" } }, retrievedAt: { type: ["string", "null"] },
              cells: { type: "object", additionalProperties: { type: "object", properties: { supported: { description: "true | false | \"partial\" | null (unknown)" }, description: { type: ["string", "null"] } } } },
            } } },
          },
        },
      },
    },
  };
}
