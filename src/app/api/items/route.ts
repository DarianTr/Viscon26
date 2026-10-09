import { z } from "zod";
import { createItem, listItems } from "@/lib/store";
import { handle } from "@/lib/http";

const createItemSchema = z.object({
  title: z.string().trim().min(1, "title is required").max(200),
});

// GET /api/items — list all items.
export async function GET() {
  return handle(async () => {
    const items = await listItems();
    return Response.json({ items });
  });
}

// POST /api/items — create an item. Body: { title: string }
export async function POST(request: Request) {
  return handle(async () => {
    const body = createItemSchema.parse(await request.json());
    const item = await createItem(body);
    return Response.json({ item }, { status: 201 });
  });
}
