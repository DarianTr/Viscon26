import { z } from "zod";
import { listChallenges, sendChallenges } from "@/lib/challenges";
import { handle, jsonError, notFound } from "@/lib/http";
import { getCurrentUser, getOwnActivity } from "@/lib/queries";

const createSchema = z.object({
  sessionId: z.uuid(),
  friendIds: z.array(z.uuid()).min(1).max(20),
  message: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => v || null),
});

// GET /api/challenges — { received, sent }, newest first.
export async function GET() {
  return handle(async () => {
    const user = await getCurrentUser();
    return Response.json(await listChallenges(user.id));
  });
}

// POST /api/challenges — body: { sessionId, friendIds, message? }. Dare friends
// to match one of your completed sessions. Friends already challenged on it
// are skipped; `sent` is how many new challenges went out.
export async function POST(request: Request) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { sessionId, friendIds, message } = createSchema.parse(await request.json());
    if (!(await getOwnActivity(user.id, sessionId))) return notFound("Activity");
    const sent = await sendChallenges(user, sessionId, friendIds, message);
    if (sent === null) return jsonError(400, "You can only challenge your friends");
    return Response.json({ sent }, { status: 201 });
  });
}
