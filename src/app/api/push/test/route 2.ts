import { handle } from "@/lib/http";
import { sendTestNudge } from "@/lib/nudges";
import { getCurrentUser } from "@/lib/queries";

// POST /api/push/test — push yourself a sample nudge, to check notifications work.
export async function POST() {
  return handle(async () => {
    const user = await getCurrentUser();
    await sendTestNudge(user.id);
    return new Response(null, { status: 204 });
  });
}
