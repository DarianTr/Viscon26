/**
 * Wipe the database so `npm run db:reset` can rebuild it from scratch:
 *
 *   1. this script: drops every table and enum type in `public`, drizzle's
 *      migration log, and empties the knowledge service's data tables (its
 *      schema, migration log and the reference rows its migrations insert
 *      stay, so a running service keeps working);
 *   2. db:migrate         recreates the schema;
 *   3. db:seed-courses    refetches the courses from VVZ and their websites;
 *   4. db:seed            creates the admin account.
 *
 * Only runs against a local database unless given --force.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (put it in .env.local).");
  process.exit(1);
}

const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1", "db"].includes(host) && !process.argv.includes("--force")) {
  console.error(`Refusing to wipe the database on ${host}. Pass --force if you really mean it.`);
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });

/** Knowledge tables filled by the service's own migrations, not by users. */
const KNOWLEDGE_KEEP = ["schema_migrations", "assessment_types"];

async function main() {
  console.log(`Wiping ${host}${new URL(url!).pathname}…`);

  const tables = await sql<{ name: string }[]>`
    select tablename as name from pg_tables where schemaname = 'public'`;
  for (const { name } of tables) await sql`drop table if exists public.${sql(name)} cascade`;

  const types = await sql<{ name: string }[]>`
    select t.typname as name from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype = 'e'`;
  for (const { name } of types) await sql`drop type if exists public.${sql(name)} cascade`;

  // drizzle-kit's log of applied migrations; without it they all run again.
  await sql`drop schema if exists drizzle cascade`;

  const knowledge = await sql<{ name: string }[]>`
    select tablename as name from pg_tables
    where schemaname = 'knowledge' and tablename not in ${sql(KNOWLEDGE_KEEP)}`;
  if (knowledge.length) {
    await sql.unsafe(`truncate ${knowledge.map((t) => `knowledge."${t.name}"`).join(", ")} cascade`);
  }

  console.log(`Dropped ${tables.length} tables and ${types.length} types; emptied ${knowledge.length} knowledge tables.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
