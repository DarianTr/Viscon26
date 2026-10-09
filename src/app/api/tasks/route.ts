import { handle, jsonError, parseQuery } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import { createTask, listTasks, ScheduleConflictError } from "@/lib/tasks";
import { createTaskSchema, listTasksQuery } from "./schemas";

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
    const { userId, ...data } = createTaskSchema.parse(await request.json());
    const owner = userId ?? (await getCurrentUser()).id;
    let task;
    try {
      task = await createTask({ ...data, userId: owner });
    } catch (error) {
      if (error instanceof ScheduleConflictError) return jsonError(409, error.message);
      throw error;
    }
    return Response.json({ task }, { status: 201 });
  });
}
