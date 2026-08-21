import { Fragment } from "react";
import { Check, X, Minus } from "lucide-react";
import { groupDimensions } from "./tables.mjs";

// Server component: renders one capability matrix table. Both the paid and free tables
// are server-rendered (so they're in the HTML / work without JS); a thin client shell
// (CapabilityMatrix) toggles which one is visible.

type Cell = { supported: boolean | "partial" | null; description: string | null };
type Dimension = { key: string; label: string; category: string; kind: "capability" | "metric" };
type Column = { vendor: string; plan: string | null; cells: Record<string, Cell> };
export type Matrix = { dimensions: Dimension[]; vendors: Column[] };

const VENDOR_LABEL: Record<string, string> = { neon: "Neon", supabase: "Supabase" };
const colLabel = (c: Column) => `${VENDOR_LABEL[c.vendor] ?? c.vendor} ${c.plan ? c.plan[0].toUpperCase() + c.plan.slice(1) : ""}`.trim();
const supportLabel = (s: Cell["supported"]) =>
  s === true ? "Offered" : s === "partial" ? "Partial" : s === false ? "Not offered" : "Unknown";

function CapabilityCell({ cell }: { cell: Cell }) {
  const icon =
    cell.supported === true ? <Check className="h-3.5 w-3.5 text-primary" aria-hidden /> :
    cell.supported === "partial" ? <Minus className="h-3.5 w-3.5 text-amber-500" aria-hidden /> :
    cell.supported === false ? <X className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden /> :
    <span className="text-muted-foreground/50" aria-hidden>—</span>;
  return (
    <div className="flex items-start gap-1.5">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="sr-only">{supportLabel(cell.supported)}.</span>
      {cell.description && <span className="text-[11px] leading-snug text-muted-foreground">{cell.description}</span>}
    </div>
  );
}

export function MatrixTable({ matrix }: { matrix: Matrix }) {
  const groups = groupDimensions(matrix.dimensions) as { category: string; dims: Dimension[] }[];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-caption">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="w-[180px] px-5 py-2.5 text-left font-medium text-muted-foreground">Feature</th>
            {matrix.vendors.map((c) => (
              <th scope="col" key={`${c.vendor}-${c.plan}`} className="px-4 py-2.5 text-left font-medium text-foreground">{colLabel(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.category}>
              <tr className="border-b border-border/60 bg-muted/30">
                <td colSpan={matrix.vendors.length + 1} className="px-5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{g.category}</td>
              </tr>
              {g.dims.map((d) => (
                <tr key={d.key} className="border-b border-border/50 align-top transition-colors hover:bg-muted/30">
                  <th scope="row" className="px-5 py-2.5 text-left font-medium text-foreground">{d.label}</th>
                  {matrix.vendors.map((c) => {
                    const cell = c.cells[d.key];
                    return (
                      <td key={`${c.vendor}-${c.plan}-${d.key}`} className="px-4 py-2.5">
                        {d.kind === "metric"
                          ? <span className="ml-5 block text-[11px] leading-snug text-muted-foreground">{cell?.description ?? "—"}</span>
                          : <CapabilityCell cell={cell ?? { supported: null, description: null }} />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
