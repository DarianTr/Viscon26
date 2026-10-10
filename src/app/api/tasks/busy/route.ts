import { z } from "zod";
import { handle, parseQuery } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import { listBusyIntervals } from "@/lib/tasks";

const querySchema = z.object({
  from: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
  to: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
});

// GET /api/tasks/busy?from=…&to=… — when you already have something on your
// calendar, so a new plan can be scheduled around it.
export async function GET(request: Request) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { from, to } = parseQuery(request, querySchema);
    return Response.json({ busy: await listBusyIntervals(user.id, from, to) });
  });
}
