import { handle, parseQuery } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import { createTask, listTasks } from "@/lib/tasks";
import { listTasksQuery, newTaskSchema } from "./schemas";

// GET /api/tasks?userId=&type=&done=&from=&to=&limit=&offset= — oldest first.
export async function GET(request: Request) {
  return handle(async () => {
    const tasks = await listTasks(parseQuery(request, listTasksQuery));
    return Response.json({ tasks });
  });
}

// POST /api/tasks — body: { type, subject, title, scheduledAt, plannedMinutes, userId?, … }
export async function POST(request: Request) {
  return handle(async () => {
    const { userId, ...data } = newTaskSchema.parse(await request.json());
    const owner = userId ?? (await getCurrentUser()).id;
    const task = await createTask({ ...data, userId: owner });
    return Response.json({ task }, { status: 201 });
  });
}
