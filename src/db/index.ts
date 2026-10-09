import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

// Reuse one connection pool across dev-server reloads instead of opening a
// new one every time a module is re-evaluated.
const globalForDb = globalThis as unknown as { __db?: Db };

function connect(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set — copy .env.example to .env.local.");
  }
  return drizzle(postgres(url, { max: 10 }), { schema });
}

/**
 * The Drizzle client. It connects on first use rather than on import, so
 * `next build` works without a database (e.g. in CI).
 */
export const db = new Proxy({} as Db, {
  get: (_, prop) => Reflect.get((globalForDb.__db ??= connect()), prop),
});

export { schema };

/** All "today" / "this week" logic is evaluated in the users' time zone. */
export const TIME_ZONE = "Europe/Zurich";
