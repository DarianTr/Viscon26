import { handle, parseQuery } from "@/lib/http";
import { createUser, listUsers } from "@/lib/users";
import { createUserSchema, listUsersQuery } from "./schemas";

// GET /api/users?q=&limit=&offset= — list users, optionally searching name/handle.
export async function GET(request: Request) {
  return handle(async () => {
    const users = await listUsers(parseQuery(request, listUsersQuery));
    return Response.json({ users });
  });
}

// POST /api/users — body: { handle, name, hue?, program?, weeklyGoalHours? }
export async function POST(request: Request) {
  return handle(async () => {
    const user = await createUser(createUserSchema.parse(await request.json()));
    return Response.json({ user }, { status: 201 });
  });
}
