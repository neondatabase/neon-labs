import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import {
  MISSING_CONNECTIONS_ERROR,
  resolveConnections,
} from "@/lib/neon-credentials";

/* POST /api/neon/replication/force-cleanup
   body: { targetConnectionString?, slotName?, subName? }
   Forcibly drops orphan replication artifacts. Each step swallows errors
   so a partial cleanup still removes what it can.
     1. ALTER SUBSCRIPTION DISABLE
     2. ALTER SUBSCRIPTION SET (slot_name = NONE), detach so DROP doesn't try
        to talk to the publisher
     3. DROP SUBSCRIPTION
     4. DROP PUBLICATION (source)
     5. SELECT pg_drop_replication_slot(...) (source)
*/

function unpool(conn: string): string {
  return conn.replace(/-pooler/g, "");
}

interface CleanupStep {
  step: string;
  ok: boolean;
  detail: string;
}

export async function POST(request: NextRequest) {
  let body: {
    targetConnectionString?: string;
    slotName?: string;
    subName?: string;
    pubName?: string;
  } = {};
  try {
    body = await request.json();
  } catch {
    /* allow empty body */
  }
  const { source, target } = await resolveConnections(body);
  if (!source || !target) {
    return NextResponse.json(
      { error: MISSING_CONNECTIONS_ERROR },
      { status: 400 },
    );
  }

  const subName = body.subName ?? "neon_advisor_sub";
  const slotName = body.slotName ?? subName;
  const pubName = body.pubName ?? "neon_advisor_pub";
  const steps: CleanupStep[] = [];

  // Target side, best-effort: disable, detach slot, drop sub
  try {
    const tgt = new Client({ connectionString: unpool(target) });
    await tgt.connect();
    try {
      for (const stmt of [
        { sql: `ALTER SUBSCRIPTION "${subName}" DISABLE`, name: "disable subscription" },
        { sql: `ALTER SUBSCRIPTION "${subName}" SET (slot_name = NONE)`, name: "detach slot name" },
        { sql: `DROP SUBSCRIPTION "${subName}"`, name: "drop subscription" },
      ]) {
        try {
          await tgt.query(stmt.sql);
          steps.push({ step: stmt.name, ok: true, detail: stmt.sql });
        } catch (err) {
          steps.push({
            step: stmt.name,
            ok: false,
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } finally {
      await tgt.end().catch(() => undefined);
    }
  } catch (err) {
    steps.push({
      step: "target connect",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // Source side, drop pub + slot
  try {
    const src = new Client({ connectionString: unpool(source) });
    await src.connect();
    try {
      try {
        await src.query(`DROP PUBLICATION IF EXISTS "${pubName}"`);
        steps.push({ step: "drop publication", ok: true, detail: `DROP PUBLICATION IF EXISTS "${pubName}"` });
      } catch (err) {
        steps.push({
          step: "drop publication",
          ok: false,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
      // Drop the slot if it's still around (subscription DROP usually cleans
      // it up, but if the subscription was detached or the publisher had a
      // stale slot, this catches it).
      try {
        const slotInfo = await src.query<{ active_pid: number | null }>(
          "SELECT active_pid FROM pg_replication_slots WHERE slot_name = $1",
          [slotName],
        );
        if (slotInfo.rows.length === 0) {
          steps.push({
            step: "drop replication slot",
            ok: true,
            detail: "slot did not exist (already clean)",
          });
        } else {
          // Drop loop, if the slot has an active walsender (orphaned from
          // a previous subscription, or Neon's auto-reconnect), terminate
          // it, then attempt DROP. Retry a few times because the walsender
          // may briefly reconnect before we get to the DROP.
          let dropped = false;
          let lastError = "";
          const terminatedPids: number[] = [];
          for (let attempt = 0; attempt < 5 && !dropped; attempt++) {
            const info = await src.query<{ active_pid: number | null }>(
              "SELECT active_pid FROM pg_replication_slots WHERE slot_name = $1",
              [slotName],
            );
            if (info.rows.length === 0) {
              dropped = true;
              break;
            }
            const pid = info.rows[0].active_pid;
            if (pid) {
              try {
                await src.query("SELECT pg_terminate_backend($1)", [pid]);
                terminatedPids.push(pid);
              } catch {
                /* may already be gone */
              }
              await new Promise((r) => setTimeout(r, 300));
            }
            try {
              await src.query("SELECT pg_drop_replication_slot($1)", [slotName]);
              dropped = true;
            } catch (err) {
              lastError = err instanceof Error ? err.message : String(err);
              await new Promise((r) => setTimeout(r, 500));
            }
          }
          if (terminatedPids.length > 0) {
            steps.push({
              step: "terminate walsender(s)",
              ok: true,
              detail: terminatedPids
                .map((p) => `pg_terminate_backend(${p})`)
                .join(" · "),
            });
          }
          steps.push({
            step: "drop replication slot",
            ok: dropped,
            detail: dropped
              ? `pg_drop_replication_slot('${slotName}')`
              : `gave up after 5 attempts: ${lastError}`,
          });
        }
      } catch (err) {
        steps.push({
          step: "drop replication slot",
          ok: false,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      await src.end().catch(() => undefined);
    }
  } catch (err) {
    steps.push({
      step: "source connect",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // Treat "X does not exist" as success, the goal of cleanup is "absent",
  // which is already the case if it was never there.
  const meaningfulFailures = steps.filter(
    (s) => !s.ok && !/does not exist/i.test(s.detail),
  );
  return NextResponse.json({
    ok: meaningfulFailures.length === 0,
    steps,
  });
}
