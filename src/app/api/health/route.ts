import { sql } from "drizzle-orm";
import { db } from "@/db";

// GET /api/health — quick check that the backend and database are alive.
export async function GET() {
  let database: "ok" | "unreachable" = "ok";
  try {
    await db.execute(sql`select 1`);
  } catch {
    database = "unreachable";
  }

  return Response.json(
    {
      status: database === "ok" ? "ok" : "degraded",
      database,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    { status: database === "ok" ? 200 : 503 },
  );
}
