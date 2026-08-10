import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export async function GET() {
  const scriptPath = join(process.cwd(), "public", "customer_pg_assessment.sh");
  const content = readFileSync(scriptPath, "utf-8");

  return new NextResponse(content, {
    headers: {
      "Content-Type": "application/x-sh",
      "Content-Disposition": 'attachment; filename="customer_pg_assessment.sh"',
    },
  });
}
