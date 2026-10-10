import { z } from "zod";
import { handle, parseQuery } from "@/lib/http";
import { getCurrentUser, searchPeople } from "@/lib/queries";

const query = z.object({ q: z.string().trim().max(100).optional() });

// GET /api/people?q= — friend search for the logged-in user. No q: friends and pending requests.
export async function GET(request: Request) {
  return handle(async () => {
    const { q } = parseQuery(request, query);
    const user = await getCurrentUser();
    return Response.json({ people: await searchPeople(user.id, q || undefined) });
  });
}
