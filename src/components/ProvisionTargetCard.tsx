"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  LogIn,
  Sparkles,
} from "lucide-react";
import { neon } from "./ui";
import type { PgMajorVersion } from "@/lib/types";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

interface OrgConfig {
  orgId: string | null;
  orgName: string | null;
  authenticated: boolean;
}

interface ProvisionResult {
  project: {
    id: string;
    name: string;
    pg_version: number;
    region_id: string;
    org_id?: string;
  };
  branch: { id: string; name: string };
  endpointHost: string | null;
  consoleUrl: string;
}

// A small curated list of the most common Neon regions. The Neon API will
// also accept any documented region_id; surfacing the popular ones keeps
// the UI simple. If we ever need full discovery we can hit GET /regions.
const REGIONS = [
  { id: "aws-us-west-2", label: "AWS · us-west-2 (Oregon)" },
  { id: "aws-us-east-1", label: "AWS · us-east-1 (N. Virginia)" },
  { id: "aws-us-east-2", label: "AWS · us-east-2 (Ohio)" },
  { id: "aws-eu-central-1", label: "AWS · eu-central-1 (Frankfurt)" },
  { id: "aws-eu-west-2", label: "AWS · eu-west-2 (London)" },
  { id: "aws-ap-southeast-1", label: "AWS · ap-southeast-1 (Singapore)" },
  { id: "azure-eastus2", label: "Azure · eastus2 (Virginia)" },
  { id: "azure-westus3", label: "Azure · westus3 (Arizona)" },
];

export function ProvisionTargetCard({
  targetVersion,
  sourceVersion,
  defaultRegion = "aws-us-west-2",
  defaultNameHint,
}: {
  targetVersion: PgMajorVersion;
  sourceVersion: PgMajorVersion;
  defaultRegion?: string;
  defaultNameHint?: string;
}) {
  const [org, setOrg] = useState<OrgConfig | null>(null);
  const [name, setName] = useState("");
  const [region, setRegion] = useState(defaultRegion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/neon/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: OrgConfig | null) => setOrg(cfg))
      .catch(() => setOrg(null));
  }, []);

  useEffect(() => {
    if (!name) {
      const base = defaultNameHint?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? "upgrade-target";
      setName(`${base}-pg${targetVersion}`);
    }
    // Only seed when targetVersion / hint changes and field is empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetVersion, defaultNameHint]);

  async function provision() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/neon/create-target", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          pgVersion: targetVersion,
          regionId: region,
          orgId: org?.orgId ?? undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Failed (${res.status})`);
      setResult(body as ProvisionResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Provisioning failed");
    } finally {
      setBusy(false);
    }
  }

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <Card className="gap-0 mt-6 p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="tag mb-2 text-[#00e599]">Provision</p>
          <h2 className={neon.h2}>Create the target Neon project</h2>
          <p className={`mt-1 text-ui ${neon.muted}`}>
            Spin up a fresh PG{targetVersion} project in{" "}
            <span className="text-foreground">{org?.orgName ?? "your org"}</span> so
            you have a destination for{" "}
            <span className="font-mono text-caption text-[#f3f4f6]">
              pg_dump → pg_restore
            </span>{" "}
            or logical replication.
          </p>
        </div>
        {!org?.authenticated && (
          <Button
            size="lg"
            variant="ghost"
            nativeButton={false}
            render={<a href="/api/auth/neon" />}
          >
            <LogIn className="h-3.5 w-3.5" />
            Sign in with Neon
          </Button>
        )}
      </div>

      {/* Form */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="target-name" className="mb-1.5">
            Project name
          </Label>
          <Input
            id="target-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`upgrade-target-pg${targetVersion}`}
            className="font-mono text-caption"
          />
          <p className="mt-1.5 text-label text-[#9ca3af]">
            Created in org{" "}
            <span className="font-mono text-[#00e599]">
              {org?.orgId ?? "(default)"}
            </span>
          </p>
        </div>
        <div>
          <Label htmlFor="target-region" className="mb-1.5">
            Region
          </Label>
          <Select value={region} onValueChange={(v) => setRegion(v as string)}>
            <SelectTrigger id="target-region" className="w-full font-mono text-caption">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REGIONS.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1.5 text-label text-[#9ca3af]">
            Source: PG{sourceVersion} · Target: PG{targetVersion}
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <p className="text-label text-[#9ca3af]">
          {org?.authenticated ? (
            <span className="text-[#00e599]">● Signed in with Neon</span>
          ) : (
            "Sign in with Neon to provision"
          )}
        </p>
        <Button size="lg" variant="white"
          onClick={() => {
            if (!org?.authenticated) {
              window.location.assign("/api/auth/neon");
              return;
            }
            provision();
          }}
          disabled={busy || !name}
        >
          {busy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Provisioning…
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" />
              Create PG{targetVersion} project
            </>
          )}
        </Button>
      </div>

      {error && (
        <div className="mt-4 rounded-[4px] border border-[#ef4444]/40 bg-[#ef4444]/10 px-3 py-2 text-caption text-[#ef4444]">
          <span className="font-mono">error:</span> {error}
        </div>
      )}

      {result && (
        <div className="mt-5 rounded-[4px] border border-[#00e599]/40 bg-[#00e599]/[0.05] p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-[#00e599]" />
              <p className="text-body font-medium text-foreground">
                {result.project.name}{" "}
                <span className="ml-1 text-[#9ca3af]">
                  · PG {result.project.pg_version}
                </span>
              </p>
            </div>
            <a
              href={result.consoleUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-[2px] text-caption text-[#00e599] transition-colors duration-150 ease-out hover:text-[#7ff5cf] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Open in Neon Console
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <dl className="grid gap-2 text-caption">
            <Row
              label="Project ID"
              value={result.project.id}
              copyValue={result.project.id}
              copied={copied === "id"}
              onCopy={() => copy("id", result.project.id)}
            />
            <Row
              label="Region"
              value={result.project.region_id}
            />
            <Row
              label="Branch"
              value={`${result.branch.name} · ${result.branch.id}`}
            />
            {result.endpointHost && (
              <Row
                label="Endpoint"
                value={result.endpointHost}
                copyValue={result.endpointHost}
                copied={copied === "host"}
                onCopy={() => copy("host", result.endpointHost!)}
              />
            )}
          </dl>

          <p className="mt-3 text-label text-[#9ca3af]">
            The app keeps only the project id. Connection credentials are
            resolved server-side when a migration step needs them.
          </p>
        </div>
      )}

    </Card>
  );
}

function Row({
  label,
  value,
  copyValue,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  copyValue?: string;
  onCopy?: () => void;
  copied?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[4px] border border-[#262727] bg-[#0c0d0d] px-3 py-2">
      <dt className="text-label uppercase tracking-[0.08em] text-[#9ca3af]">
        {label}
      </dt>
      <div className="flex min-w-0 items-center gap-2">
        <dd className="truncate font-mono text-caption text-[#f3f4f6]">
          {value}
        </dd>
        {copyValue && (
          <button
            type="button"
            onClick={onCopy}
            className="rounded-[4px] p-1 text-[#9ca3af] hover:bg-[#1a1b1b] hover:text-foreground"
            aria-label={`Copy ${label}`}
          >
            {copied ? (
              <Check className="h-3 w-3 text-[#00e599]" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
