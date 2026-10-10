/**
 * Creates the admin account: `npm run db:seed`.
 *
 * The only seeded row. Everything else starts empty and is created by using
 * the app. Safe to run on every start: it never wipes anything. If someone
 * already signed up with ADMIN_EMAIL, it makes that account the admin.
 *
 * The admin belongs to whoever logs in with ADMIN_EMAIL (their X-User-Id,
 * see `src/lib/auth.ts`); there is no password.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as s from "./schema";

const ADMIN_HANDLE = process.env.ADMIN_HANDLE || "admin";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "tprazak@ethz.ch").toLowerCase();
const ADMIN_NAME = process.env.ADMIN_NAME || "Admin";

const client = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema: s });

async function main() {
  // Someone who signed up with ADMIN_EMAIL before the seed ran keeps their account.
  const [promoted] = await db
    .update(s.users)
    .set({ isAdmin: true })
    .where(eq(s.users.email, ADMIN_EMAIL))
    .returning({ handle: s.users.handle });
  if (promoted) {
    console.log(`@${promoted.handle} (${ADMIN_EMAIL}) is the admin.`);
    return;
  }

  const taken = await db.query.users.findFirst({ where: eq(s.users.handle, ADMIN_HANDLE) });
  if (taken) {
    console.log(`@${ADMIN_HANDLE} is taken by ${taken.email ?? "an account without email"} — not creating the admin.`);
    return;
  }

  await db.insert(s.users).values({ handle: ADMIN_HANDLE, email: ADMIN_EMAIL, name: ADMIN_NAME, isAdmin: true });
  console.log(`Created admin @${ADMIN_HANDLE}, who logs in as ${ADMIN_EMAIL}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
