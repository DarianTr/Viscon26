import { ZodError } from "zod";

/** Shape every error response shares, so the frontend can rely on it. */
export type ApiError = { error: string; details?: unknown };

export function jsonError(
  status: number,
  error: string,
  details?: unknown,
): Response {
  return Response.json({ error, details } satisfies ApiError, { status });
}

export const notFound = (what = "Resource") => jsonError(404, `${what} not found`);

/**
 * Wrap a route handler body so validation and unexpected errors turn into
 * consistent JSON instead of an opaque 500.
 */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ZodError) {
      return jsonError(400, "Invalid request body", err.issues);
    }
    if (err instanceof SyntaxError) {
      return jsonError(400, "Request body must be valid JSON");
    }
    console.error(err);
    return jsonError(500, "Internal server error");
  }
}
