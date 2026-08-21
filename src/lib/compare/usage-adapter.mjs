// Adapter: neon-usage's current_period_snapshot (real Neon consumption) → the
// estimator's usage input. This is what makes use case (a) "real" — the numbers
// come from Neon's own metrics, not hand-typed. Metric names + units observed
// from `neon-usage current-report --output json` (see fixtures/demo-snapshot.json).
//
//   computeTimeSeconds   CU-seconds → CU-hours     ÷ 3600           (Neon's compute meter)
//   activeTimeSeconds    active wall-clock → hours  ÷ 3600           (context / avg CU)
//   dataStorageByteHours byte-hours → GB-months     ÷ 744 ÷ 1e9      (per usage-calculations doc)
//   dataTransferBytes    bytes → egress GB          ÷ 1e9
//   writtenDataBytes                                (not a separate Neon bill line — ignored)

const HOURS_PER_MONTH = 744; // Neon's fixed billing month
const num = (v) => (v == null ? 0 : Number(v));

/** One project's metrics → usage. Compute is MEASURED (no inference). */
export function projectToUsage(project) {
  const m = project.metrics ?? {};
  const cuHours = num(m.computeTimeSeconds) / 3600;
  const activeHours = num(m.activeTimeSeconds) / 3600;
  return {
    projectId: project.projectId,
    cuHours: round(cuHours, 2),
    activeHours: round(activeHours, 1),
    avgCu: activeHours > 0 ? round(cuHours / activeHours, 3) : 0,
    // byte-hours → GB-months (billing unit): ÷ 744 ÷ 1e9.
    storageGb: round(num(m.dataStorageByteHours) / HOURS_PER_MONTH / 1e9, 3),
    egressGb: round(num(m.dataTransferBytes) / 1e9, 2),
  };
}

/** Whole snapshot → per-project usage + an aggregate (org-wide) usage. */
export function snapshotToUsage(snapshot) {
  const projects = (snapshot.projects ?? []).map(projectToUsage);
  const total = projects.reduce(
    (t, p) => ({
      cuHours: round(t.cuHours + p.cuHours, 2),
      activeHours: Math.max(t.activeHours, p.activeHours), // org active ≈ the busiest project
      storageGb: round(t.storageGb + p.storageGb, 3),
      egressGb: round(t.egressGb + p.egressGb, 2),
    }),
    { cuHours: 0, activeHours: 0, storageGb: 0, egressGb: 0 },
  );
  return { period: snapshot.projects?.[0]?.period ?? null, projects, total };
}

function round(n, dp) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
