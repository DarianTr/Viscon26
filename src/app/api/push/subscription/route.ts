import { z } from "zod";
import { handle } from "@/lib/http";
import { deleteSubscription, saveSubscription } from "@/lib/push";
import { getCurrentUser } from "@/lib/queries";

/** `PushSubscription.toJSON()`, as the browser sends it. */
const subscriptionSchema = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

// PUT /api/push/subscription — body: a PushSubscription. Push to this device from now on.
export async function PUT(request: Request) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { endpoint, keys } = subscriptionSchema.parse(await request.json());
    await saveSubscription(user.id, { endpoint, ...keys });
    return new Response(null, { status: 204 });
  });
}

// DELETE /api/push/subscription — body: { endpoint }. Stop pushing to this device.
export async function DELETE(request: Request) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { endpoint } = subscriptionSchema.pick({ endpoint: true }).parse(await request.json());
    await deleteSubscription(user.id, endpoint);
    return new Response(null, { status: 204 });
  });
}
