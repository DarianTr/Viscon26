/** Shared between the backend (route handlers) and the frontend. */
export type Item = {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
};
