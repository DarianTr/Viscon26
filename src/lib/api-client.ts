import type { Challenge, Comment, FriendStatus, Item, Person, SessionType, TaskRecord } from "./types";

export type NewSession = {
  type: SessionType;
  subject: string;
  title: string;
  /** ISO timestamp. */
  scheduledAt: string;
  plannedMinutes: number;
  userPlanId?: string | null;
  note?: string | null;
  shared?: boolean;
  /** Logged after the fact rather than planned ahead. */
  done?: boolean;
};

/**
 * Thin client for the backend in `src/app/api`. Relative URLs keep it working
 * in dev, in preview and in production without any configuration.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    // FormData bodies set their own multipart Content-Type.
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init?.headers },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }

  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  listItems: () => request<{ items: Item[] }>("/items").then((r) => r.items),

  createItem: (title: string) =>
    request<{ item: Item }>("/items", {
      method: "POST",
      body: JSON.stringify({ title }),
    }).then((r) => r.item),

  updateItem: (id: string, patch: { title?: string; done?: boolean }) =>
    request<{ item: Item }>(`/items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }).then((r) => r.item),

  deleteItem: (id: string) =>
    request<void>(`/items/${id}`, { method: "DELETE" }),

  /** Mark a task done (with its real length, if timed) or undo it. */
  setTaskDone: (id: string, done: boolean, actualMinutes?: number) =>
    request<{ task: TaskRecord }>(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ done, actualMinutes }),
    }).then((r) => r.task),

  /** Skip a planned session (it stays on the calendar, marked skipped) or undo that. */
  setTaskSkipped: (id: string, skipped: boolean) =>
    request<{ task: TaskRecord }>(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ skipped }),
    }).then((r) => r.task),

  /** Add a session by hand: planned ahead, or logged after the fact with `done: true`. */
  createTask: (task: NewSession) =>
    request<{ task: TaskRecord }>("/tasks", {
      method: "POST",
      body: JSON.stringify(task),
    }).then((r) => r.task),

  getTask: (id: string) => request<{ task: TaskRecord }>(`/tasks/${id}`).then((r) => r.task),

  /** Change a session you added by hand. */
  updateTask: (id: string, patch: Partial<Omit<NewSession, "done">>) =>
    request<{ task: TaskRecord }>(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }).then((r) => r.task),

  /** Remove a session you added by hand. */
  deleteTask: (id: string) => request<void>(`/tasks/${id}`, { method: "DELETE" }),

  /** Rename your own activity's title and/or caption. */
  updateActivity: (id: string, patch: { title?: string; note?: string | null }) =>
    request<{ task: TaskRecord }>(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }).then((r) => r.task),

  /** Make your own activity visible to friends (shared) or private (only you). */
  setActivityShared: (id: string, shared: boolean) =>
    request<{ task: TaskRecord }>(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ shared }),
    }).then((r) => r.task),

  setKudos: (taskId: string, on: boolean) =>
    request<void>(`/tasks/${taskId}/kudos`, { method: on ? "PUT" : "DELETE" }),

  listComments: (taskId: string) =>
    request<{ comments: Comment[] }>(`/tasks/${taskId}/comments`).then((r) => r.comments),

  addComment: (taskId: string, body: string) =>
    request<{ comment: Comment }>(`/tasks/${taskId}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }).then((r) => r.comment),

  deleteComment: (taskId: string, commentId: string) =>
    request<void>(`/tasks/${taskId}/comments/${commentId}`, { method: "DELETE" }),

  /** Upload a photo to your own activity. */
  addPhoto: (taskId: string, photo: Blob) => {
    const form = new FormData();
    form.append("photo", photo, "photo");
    return request<{ photo: { id: string; url: string } }>(`/tasks/${taskId}/photos`, {
      method: "POST",
      body: form,
    }).then((r) => r.photo);
  },

  deletePhoto: (taskId: string, photoId: string) =>
    request<void>(`/tasks/${taskId}/photos/${photoId}`, { method: "DELETE" }),

  /** Replace the friends tagged on your own activity. */
  setTags: (taskId: string, userIds: string[]) =>
    request<void>(`/tasks/${taskId}/tags`, { method: "PUT", body: JSON.stringify({ userIds }) }),

  /** Find people by name or handle; without a query, your friends and pending requests. */
  searchPeople: (q: string, init?: RequestInit) =>
    request<{ people: Person[] }>(`/people?${new URLSearchParams({ q })}`, init).then((r) => r.people),

  /** On: send a friend request, or accept theirs. Off: cancel, decline or unfriend. */
  setFriend: (userId: string, on: boolean) =>
    request<{ status: FriendStatus }>(`/users/${userId}/friend`, { method: on ? "PUT" : "DELETE" }).then(
      (r) => r.status,
    ),

  listChallenges: () => request<{ received: Challenge[]; sent: Challenge[] }>("/challenges"),

  /** Dare friends to match one of your completed sessions. Resolves to how many were sent. */
  sendChallenge: (sessionId: string, friendIds: string[], message: string) =>
    request<{ sent: number }>("/challenges", {
      method: "POST",
      body: JSON.stringify({ sessionId, friendIds, message }),
    }).then((r) => r.sent),

  respondToChallenge: (id: string, accept: boolean) =>
    request<void>(`/challenges/${id}`, { method: "PATCH", body: JSON.stringify({ accept }) }),

  withdrawChallenge: (id: string) => request<void>(`/challenges/${id}`, { method: "DELETE" }),

  savePushSubscription: (sub: PushSubscriptionJSON) =>
    request<void>("/push/subscription", { method: "PUT", body: JSON.stringify(sub) }),

  deletePushSubscription: (endpoint: string) =>
    request<void>("/push/subscription", { method: "DELETE", body: JSON.stringify({ endpoint }) }),

  sendTestPush: () => request<void>("/push/test", { method: "POST" }),
};
