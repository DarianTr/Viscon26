/**
 * Set a user's password, and optionally make them an admin:
 *
 *   npm run db:set-password -- <handle> <password> [--admin]
 *
 * Use it to create the first admin on a database that wasn't seeded.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as s from "./schema";
import { hashPassword } from "./password";

const [handle, password] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const admin = process.argv.includes("--admin");

if (!handle || !password) {
  console.error("Usage: npm run db:set-password -- <handle> <password> [--admin]");
  process.exit(1);
}

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema: s });

async function main() {
  const rows = await db
    .update(s.users)
    .set({ passwordHash: await hashPassword(password), ...(admin && { isAdmin: true }) })
    .where(eq(s.users.handle, handle))
    .returning({ id: s.users.id });
  if (!rows.length) {
    console.error(`No user @${handle}.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Password set for @${handle}${admin ? " (admin)" : ""}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
