// GET /api/health — quick check that the backend is alive.
export async function GET() {
  return Response.json({
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
}
