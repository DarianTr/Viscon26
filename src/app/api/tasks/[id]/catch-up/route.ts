import { z } from "zod";
import { handle, isId, notFound } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import { logBufferStudy } from "@/lib/tasks";

type Ctx = RouteContext<"/api/tasks/[id]/catch-up">;

const bodySchema = z.object({
  subject: z.string().trim().min(1).max(100),
  minutes: z.number().int().min(1).max(24 * 60),
});

// POST /api/tasks/:id/catch-up — log study done during a buffer block. The
// time is attributed to the subject and taken out of the buffer.
export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { id } = await ctx.params;
    if (!isId(id)) return notFound("Buffer");
    const { subject, minutes } = bodySchema.parse(await request.json());
    const outcome = await logBufferStudy(user.id, id, subject, minutes);
    return outcome ? Response.json(outcome, { status: 201 }) : notFound("Buffer");
  });
}
