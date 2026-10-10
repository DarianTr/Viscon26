import { DrizzleQueryError } from "drizzle-orm/errors";
import { unstable_rethrow } from "next/navigation";
import { z, ZodError } from "zod";
import { getSessionUser } from "./auth";

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

/** The request conflicts with existing data (e.g. overlapping calendar blocks) — answered with 409. */
export class ConflictError extends Error {}

/** Row ids are UUIDs; anything else can't exist, so callers can 404 early. */
export const isId = (value: string) => z.uuid().safeParse(value).success;

/** Parse a request's query string against a zod schema. */
export function parseQuery<T extends z.ZodType>(request: Request, schema: T): z.infer<T> {
  return schema.parse(Object.fromEntries(new URL(request.url).searchParams));
}

/** The Postgres error behind a failed query, if there is one. */
function pgError(err: unknown): { code?: string; detail?: string } | null {
  const cause = err instanceof DrizzleQueryError ? err.cause : err;
  return cause && typeof cause === "object" && "code" in cause
    ? (cause as { code?: string; detail?: string })
    : null;
}

/**
 * Wrap a route handler body so validation and unexpected errors turn into
 * consistent JSON instead of an opaque 500. Also requires a logged-in user:
 * every endpoint that uses this answers 401 without a valid session.
 */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    if (!(await getSessionUser())) return jsonError(401, "Not logged in");
    return await fn();
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof ZodError) {
      return jsonError(400, "Invalid request", err.issues);
    }
    if (err instanceof SyntaxError) {
      return jsonError(400, "Request body must be valid JSON");
    }
    if (err instanceof ConflictError) return jsonError(409, err.message);
    // Constraint violations are the caller's fault, not the server's.
    const pg = pgError(err);
    if (pg?.code === "23505") return jsonError(409, "Already exists", pg.detail);
    if (pg?.code === "23503") return jsonError(400, "Referenced record does not exist", pg.detail);
    console.error(err);
    return jsonError(500, "Internal server error");
  }
}
