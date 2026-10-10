import type { Comment, FriendStatus, Item, Person, TaskRecord } from "./types";

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

  /** Rename your own activity's title and/or caption. */
  updateActivity: (id: string, patch: { title?: string; note?: string | null }) =>
    request<{ task: TaskRecord }>(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
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
};
