"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import {
  EXTENSION_PG_MAJORS,
  NEON_EXTENSIONS,
  countByStatus,
} from "@/lib/extensions";
import { PageHeader, StatusBadge, neon } from "@/components/ui";
import type { ExtensionSupportStatus, NeonExtension } from "@/lib/types";
import { DataTable } from "@/components/data-table";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

const FILTERS: { id: ExtensionSupportStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "available", label: "Available" },
  { id: "under_review", label: "Under review" },
  { id: "planned", label: "Planned" },
  { id: "not_supported", label: "Not supported" },
];

const STATUS_ORDER: Record<ExtensionSupportStatus, number> = {
  available: 0,
  under_review: 1,
  planned: 2,
  not_supported: 3,
};

type ExtensionPgMajor = (typeof EXTENSION_PG_MAJORS)[number];
type CompatFilter = "any" | `pg${ExtensionPgMajor}`;
type ExtensionVersionKey = Exclude<CompatFilter, "any">;

const COMPAT: { id: CompatFilter; label: string }[] = [
  { id: "any", label: "Any version" },
  ...EXTENSION_PG_MAJORS.map((major) => ({
    id: `pg${major}` as ExtensionVersionKey,
    label: `Runs on PG ${major}`,
  })),
];

function compareVersions(a?: string, b?: string) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

const versionColumns: ColumnDef<NeonExtension, unknown>[] =
  EXTENSION_PG_MAJORS.map((major) => {
    const key = `pg${major}` as ExtensionVersionKey;
    return {
      id: key,
      accessorFn: (extension) => extension[key],
      header: `PG ${major}`,
      cell: ({ row }) => (
        <span className="font-mono text-label tnum text-foreground">
          {row.original[key] ?? "—"}
        </span>
      ),
      sortingFn: (a, b) =>
        compareVersions(a.original[key], b.original[key]),
    };
  });

const columns: ColumnDef<NeonExtension, unknown>[] = [
  {
    accessorKey: "name",
    header: "Extension",
    cell: ({ row }) => (
      <span className="font-mono text-caption text-primary">
        {row.original.name}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
    sortingFn: (a, b) =>
      STATUS_ORDER[a.original.status] - STATUS_ORDER[b.original.status],
  },
  ...versionColumns,
  {
    id: "notes",
    accessorFn: (extension) =>
      [extension.description, extension.comments].filter(Boolean).join(" "),
    header: "Notes",
    enableSorting: false,
    cell: ({ row }) => {
      const notes = [
        row.original.description,
        row.original.comments !== row.original.description
          ? row.original.comments
          : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return (
        <p
          className="min-w-56 max-w-80 truncate whitespace-nowrap text-caption text-muted-foreground"
          title={notes || undefined}
        >
          {notes || "—"}
        </p>
      );
    },
  },
];

export default function ExtensionsPage() {
  const [filter, setFilter] = useState<ExtensionSupportStatus | "all">("all");
  const [compat, setCompat] = useState<CompatFilter>("any");
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([
    { id: "name", desc: false },
  ]);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey) return;
      const active = document.activeElement;
      const typing =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      if (typing) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const rows = useMemo(
    () =>
      NEON_EXTENSIONS.filter((ext) => {
        if (filter !== "all" && ext.status !== filter) return false;
        if (compat !== "any") return Boolean(ext[compat]);
        return true;
      }),
    [compat, filter]
  );

  const counts = {
    all: NEON_EXTENSIONS.length,
    available: countByStatus("available"),
    under_review: countByStatus("under_review"),
    planned: countByStatus("planned"),
    not_supported: countByStatus("not_supported"),
  };

  return (
    <div className={`${neon.page} flex h-full flex-col`}>
      <div className={`${neon.pageContent} flex min-h-0 w-full flex-1 flex-col`}>
        <PageHeader
          title="Extensions"
          subtitle="Full reference of PostgreSQL extensions supported on Neon Serverless Postgres."
        />

        <Card className="flex min-h-0 flex-1 flex-col gap-0">
          <CardHeader className="border-b border-border px-5 py-4">
            <h2 className={neon.h2}>Extension compatibility</h2>
            <p className={`mt-1 text-caption ${neon.muted}`}>
              {NEON_EXTENSIONS.length} extensions tracked ·{" "}
              <a
                href="https://neon.com/docs/extensions/pg-extensions"
                className="rounded-[2px] text-primary underline decoration-primary/40 underline-offset-2 transition-colors duration-150 ease-out hover:text-[#7ff5cf] hover:decoration-[#7ff5cf] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                target="_blank"
                rel="noreferrer"
              >
                Neon extension docs
              </a>
            </p>
          </CardHeader>

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map(({ id, label }) => (
                <Button
                  key={id}
                  type="button"
                  size="xs"
                  variant={filter === id ? "white" : "outline"}
                  onClick={() => setFilter(id)}
                  className="text-label"
                >
                  {label}
                  <span className="ml-1.5 font-mono tnum text-muted-foreground">
                    {counts[id]}
                  </span>
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={compat}
                onValueChange={(v) => setCompat(v as typeof compat)}
              >
                <SelectTrigger
                  aria-label="Filter by Postgres compatibility"
                  className="w-[130px] text-caption"
                >
                  <span
                    className={
                      compat === "any" ? "text-muted-foreground" : undefined
                    }
                  >
                    {compat === "any"
                      ? "PG version"
                      : `PG ${compat.replace("pg", "")}`}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {COMPAT.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchRef}
                  type="text"
                  placeholder="Search extensions..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setSearch("");
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-64 bg-background px-8 text-caption"
                />
                {search ? (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                      setSearch("");
                      searchRef.current?.focus();
                    }}
                    className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-[2px] text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : (
                  <Kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
                    /
                  </Kbd>
                )}
              </div>
            </div>
          </div>

          <DataTable
            columns={columns}
            data={rows}
            globalFilter={search}
            sorting={sorting}
            onSortingChange={setSorting}
            getRowId={(row) => row.name}
            emptyMessage="No extensions match the current filter."
            scrollAreaClassName="min-h-0 flex-1"
          />
        </Card>
      </div>
    </div>
  );
}
