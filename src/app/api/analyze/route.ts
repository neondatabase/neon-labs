import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { analyzeBundle } from "@/lib/analyzer";
import type { PgMajorVersion } from "@/lib/types";

function asMajor(v: string | null, fallback: PgMajorVersion): PgMajorVersion {
  const n = parseInt(v ?? "", 10);
  if (n === 14 || n === 15 || n === 16 || n === 17 || n === 18) return n;
  return fallback;
}

export async function GET() {
  return NextResponse.json(
    { error: "Use POST with a ZIP produced by customer_pg_assessment.sh" },
    { status: 400 },
  );
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("file") as File | null;
  const sourceVersion = asMajor(form.get("sourceVersion") as string | null, 14);
  const targetVersion = asMajor(form.get("targetVersion") as string | null, 17);

  if (!file) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  try {
    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    const files = new Map<string, string>();

    for (const [path, entry] of Object.entries(zip.files)) {
      if (!entry.dir && !path.includes("__MACOSX")) {
        const content = await entry.async("string");
        files.set(path, content);
      }
    }

    if (files.size === 0) {
      return NextResponse.json({ error: "Empty or invalid ZIP" }, { status: 400 });
    }

    const result = analyzeBundle(files, sourceVersion, targetVersion);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to analyze bundle";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
