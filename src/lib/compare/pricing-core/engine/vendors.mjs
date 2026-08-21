// Neon + Supabase vendor data (rates + plans). Other competitors are intentionally
// excluded. Neon is our authoritative copy; Supabase is sourced from the canonical
// backend-cost-forecast table (cite source + retrievedAt in any comparison output).
import { deepFreeze } from "./util.mjs";

export const VENDORS = deepFreeze({
  "neon": {
    "label": "Neon",
    "freeKind": "permanent",
    "currency": "USD",
    "sourceUrl": "https://neon.com/pricing",
    "sources": [
      "https://neon.com/pricing",
      "https://neon.com/docs/introduction/usage-calculations",
      "https://neon.com/docs/introduction/plans"
    ],
    "retrievedAt": "2026-08-08",
    "billing": {
      "computeUnit": "CU-hour",
      "granularity": "second",
      "scaleToZero": true,
      "autoscaling": true,
      "storage": "decoupled_per_gb",
      "storageUnit": "GB",
      "minimum": "none",
      "costDriver": "actual_usage"
    },
    "autoscales": true,
    "scalesToZero": true,
    "plans": {
      "free": {
        "label": "Free",
        "billed": false,
        "onExceed": "suspend",
        "paidFallback": "launch",
        "requiresCard": false,
        "newCustomerOnly": false,
        "durationDays": null,
        "onIdle": {
          "action": "suspend",
          "afterMinutes": 5,
          "autoResume": true,
          "resumeSeconds": 0.5
        },
        "dataLoss": {
          "risk": "none"
        },
        "backups": true,
        "pitr": false,
        "compute": {
          "model": "cu_hour",
          "maxVcpu": 2,
          "maxRamGb": 8,
          "sharedCpu": false,
          "budget": {
            "unit": "CU-hour",
            "amount": "100",
            "scope": "per_project"
          },
          "scaleToZeroMinutes": 5
        },
        "allowances": {
          "compute": {
            "unit": "CU-hour",
            "limit": "100",
            "scope": "per_project",
            "note": "autoscale up to 2 CU"
          },
          "storage": {
            "unit": "GB",
            "limit": "0.5",
            "scope": "per_project"
          },
          "egress": {
            "unit": "GB",
            "limit": "5"
          },
          "mau": {
            "unit": "MAU",
            "limit": "60000",
            "note": "up to 60k MAU (neon.com/docs/introduction/plans)"
          },
          "projects": {
            "unit": "projects",
            "limit": "100"
          },
          "branches": {
            "unit": "branches",
            "limit": "10",
            "scope": "per_project"
          }
        },
        "note": "Compute suspends after ~5 min idle (suspended time doesn't count); auto-resumes on next query."
      },
      "launch": {
        "label": "Launch",
        "baseMonthlyFee": "0",
        "computeModel": "cu_hour",
        "metrics": {
          "compute": {
            "unit": "CU-hour",
            "overageRate": "0.106",
            "includedQuota": "0"
          },
          "storage": {
            "unit": "GB-month",
            "overageRate": "0.35",
            "includedQuota": "0"
          },
          "child_storage": {
            "unit": "GB-month",
            "overageRate": "0.35",
            "includedQuota": "0"
          },
          "instant_restore": {
            "unit": "GB-month",
            "overageRate": "0.20",
            "includedQuota": "0"
          },
          "snapshots": {
            "unit": "GB-month",
            "overageRate": "0.09",
            "includedQuota": "0"
          },
          "egress": {
            "unit": "GB",
            "overageRate": "0.10",
            "includedQuota": "500",
            "scope": "per_project"
          },
          "branches": {
            "unit": "branch-month",
            "overageRate": "1.50",
            "includedQuota": "9"
          }
        }
      },
      "scale": {
        "label": "Scale",
        "baseMonthlyFee": "0",
        "computeModel": "cu_hour",
        "metrics": {
          "compute": {
            "unit": "CU-hour",
            "overageRate": "0.222",
            "includedQuota": "0"
          },
          "storage": {
            "unit": "GB-month",
            "overageRate": "0.35",
            "includedQuota": "0"
          },
          "child_storage": {
            "unit": "GB-month",
            "overageRate": "0.35",
            "includedQuota": "0"
          },
          "instant_restore": {
            "unit": "GB-month",
            "overageRate": "0.20",
            "includedQuota": "0"
          },
          "snapshots": {
            "unit": "GB-month",
            "overageRate": "0.09",
            "includedQuota": "0"
          },
          "egress": {
            "unit": "GB",
            "overageRate": "0.10",
            "includedQuota": "500",
            "scope": "per_project"
          },
          "branches": {
            "unit": "branch-month",
            "overageRate": "1.50",
            "includedQuota": "24"
          },
          "private_transfer": {
            "unit": "GB",
            "overageRate": "0.01",
            "includedQuota": "0"
          }
        }
      },
      "agent": {
        "label": "Agent",
        "baseMonthlyFee": "0",
        "computeModel": "cu_hour",
        "ratesAssumed": true,
        "metrics": {
          "compute": {
            "unit": "CU-hour",
            "overageRate": "0.106",
            "includedQuota": "0"
          },
          "storage": {
            "unit": "GB-month",
            "overageRate": "0.35",
            "includedQuota": "0"
          },
          "child_storage": {
            "unit": "GB-month",
            "overageRate": "0.35",
            "includedQuota": "0"
          },
          "instant_restore": {
            "unit": "GB-month",
            "overageRate": "0.20",
            "includedQuota": "0"
          },
          "snapshots": {
            "unit": "GB-month",
            "overageRate": "0.09",
            "includedQuota": "0"
          },
          "egress": {
            "unit": "GB",
            "overageRate": "0.10",
            "includedQuota": "500",
            "scope": "per_project"
          },
          "branches": {
            "unit": "branch-month",
            "overageRate": "1.50",
            "includedQuota": "24"
          },
          "private_transfer": {
            "unit": "GB",
            "overageRate": "0.01",
            "includedQuota": "0"
          }
        }
      },
      "enterprise": {
        "label": "Enterprise",
        "baseMonthlyFee": "0",
        "computeModel": "cu_hour",
        "ratesAssumed": true,
        "metrics": {
          "compute": {
            "unit": "CU-hour",
            "overageRate": "0.222",
            "includedQuota": "0"
          },
          "storage": {
            "unit": "GB-month",
            "overageRate": "0.35",
            "includedQuota": "0"
          },
          "child_storage": {
            "unit": "GB-month",
            "overageRate": "0.35",
            "includedQuota": "0"
          },
          "instant_restore": {
            "unit": "GB-month",
            "overageRate": "0.20",
            "includedQuota": "0"
          },
          "snapshots": {
            "unit": "GB-month",
            "overageRate": "0.09",
            "includedQuota": "0"
          },
          "egress": {
            "unit": "GB",
            "overageRate": "0.10",
            "includedQuota": "500",
            "scope": "per_project"
          },
          "branches": {
            "unit": "branch-month",
            "overageRate": "1.50",
            "includedQuota": "24"
          },
          "private_transfer": {
            "unit": "GB",
            "overageRate": "0.01",
            "includedQuota": "0"
          }
        }
      }
    }
  },
  "supabase": {
    "label": "Supabase",
    "freeKind": "permanent",
    "currency": "USD",
    "sourceUrl": "https://supabase.com/pricing",
    "sources": [
      "https://supabase.com/pricing",
      "https://supabase.com/docs/guides/platform/compute-and-disk",
      "https://supabase.com/docs/guides/platform/manage-your-usage/egress"
    ],
    "retrievedAt": "2026-08-18",
    "billing": {
      "computeUnit": "instance-month",
      "granularity": "hour",
      "scaleToZero": false,
      "autoscaling": false,
      "storage": "decoupled_per_gb",
      "storageUnit": "GB",
      "minimum": "$25/mo base (Pro)",
      "costDriver": "provisioned_peak"
    },
    "plans": {
      "free": {
        "label": "Free",
        "billed": false,
        "onExceed": "pause",
        "paidFallback": "pro",
        "requiresCard": false,
        "newCustomerOnly": false,
        "durationDays": null,
        "onIdle": {
          "action": "pause",
          "afterDays": 7,
          "autoResume": false
        },
        "dataLoss": {
          "risk": "delete_after_paused",
          "afterDays": 365
        },
        "backups": false,
        "pitr": false,
        "compute": {
          "model": "fixed_instance",
          "maxVcpu": null,
          "maxRamGb": 0.5,
          "sharedCpu": true,
          "budget": null
        },
        "allowances": {
          "compute": {
            "unit": "CU-hour",
            "limit": null,
            "note": "fixed Nano (~0.5 GB RAM), not CU-metered; always-on while active, pauses after ~1 week idle"
          },
          "storage": {
            "unit": "GB",
            "limit": "0.5",
            "scope": "per_project",
            "note": "500 MB database"
          },
          "file_storage": {
            "unit": "GB",
            "limit": "1"
          },
          "egress": {
            "unit": "GB",
            "limit": "5"
          },
          "mau": {
            "unit": "MAU",
            "limit": "50000"
          },
          "projects": {
            "unit": "active projects",
            "limit": "2"
          }
        },
        "note": "Project pauses after ~1 week idle (manual restore); no backups/PITR on Free."
      },
      "pro": {
        "label": "Pro",
        "baseMonthlyFee": "25",
        "computeModel": "instance_month",
        "computeCreditMonthly": "10",
        "instances": {
          "micro": {
            "label": "Micro (1 GB / 2-core)",
            "ramGb": 1,
            "monthlyPrice": "10"
          },
          "small": {
            "label": "Small (2 GB)",
            "ramGb": 2,
            "monthlyPrice": "15"
          },
          "medium": {
            "label": "Medium (4 GB)",
            "ramGb": 4,
            "monthlyPrice": "60"
          },
          "large": {
            "label": "Large (8 GB)",
            "ramGb": 8,
            "monthlyPrice": "110"
          },
          "xl": {
            "label": "XL (16 GB)",
            "ramGb": 16,
            "monthlyPrice": "210"
          },
          "2xl": {
            "label": "2XL (32 GB)",
            "ramGb": 32,
            "monthlyPrice": "410"
          },
          "4xl": {
            "label": "4XL (64 GB)",
            "ramGb": 64,
            "monthlyPrice": "960"
          },
          "8xl": {
            "label": "8XL (128 GB)",
            "ramGb": 128,
            "monthlyPrice": "1870"
          }
        },
        "metrics": {
          "storage": {
            "unit": "GB-month",
            "overageRate": "0.125",
            "includedQuota": "8"
          },
          "egress": {
            "unit": "GB",
            "overageRate": "0.09",
            "includedQuota": "250",
            "scope": "per_org"
          },
          "cached_egress": {
            "unit": "GB",
            "overageRate": "0.03",
            "includedQuota": "250"
          },
          "file_storage": {
            "unit": "GB",
            "overageRate": "0.0213",
            "includedQuota": "100"
          },
          "mau": {
            "unit": "MAU",
            "overageRate": "0.00325",
            "includedQuota": "100000"
          },
          "branches": {
            "unit": "branch-hour",
            "overageRate": "0.01344",
            "includedQuota": "0"
          }
        }
      },
      "team": {
        "label": "Team",
        "baseMonthlyFee": "599",
        "computeModel": "instance_month",
        "computeCreditMonthly": "10",
        "instances": {
          "micro": {
            "label": "Micro (1 GB / 2-core)",
            "ramGb": 1,
            "monthlyPrice": "10"
          },
          "small": {
            "label": "Small (2 GB)",
            "ramGb": 2,
            "monthlyPrice": "15"
          },
          "medium": {
            "label": "Medium (4 GB)",
            "ramGb": 4,
            "monthlyPrice": "60"
          },
          "large": {
            "label": "Large (8 GB)",
            "ramGb": 8,
            "monthlyPrice": "110"
          },
          "xl": {
            "label": "XL (16 GB)",
            "ramGb": 16,
            "monthlyPrice": "210"
          },
          "2xl": {
            "label": "2XL (32 GB)",
            "ramGb": 32,
            "monthlyPrice": "410"
          },
          "4xl": {
            "label": "4XL (64 GB)",
            "ramGb": 64,
            "monthlyPrice": "960"
          },
          "8xl": {
            "label": "8XL (128 GB)",
            "ramGb": 128,
            "monthlyPrice": "1870"
          }
        },
        "metrics": {
          "storage": {
            "unit": "GB-month",
            "overageRate": "0.125",
            "includedQuota": "8"
          },
          "egress": {
            "unit": "GB",
            "overageRate": "0.09",
            "includedQuota": "250",
            "scope": "per_org"
          },
          "cached_egress": {
            "unit": "GB",
            "overageRate": "0.03",
            "includedQuota": "250"
          },
          "file_storage": {
            "unit": "GB",
            "overageRate": "0.0213",
            "includedQuota": "100"
          },
          "mau": {
            "unit": "MAU",
            "overageRate": "0.00325",
            "includedQuota": "100000"
          }
        }
      },
      "enterprise": {
        "label": "Enterprise",
        "billed": false,
        "note": "Custom / quote-only."
      }
    }
  }
});
