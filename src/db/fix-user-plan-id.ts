import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client);

async function main() {
  const result = await db.execute(
    sql`SELECT column_name FROM information_schema.columns WHERE table_name='sessions' AND column_name='user_plan_id'`,
  );

  if (result.length > 0) {
    console.log("✓ Column user_plan_id already exists — nothing to do.");
  } else {
    console.log("Column missing, applying migration…");
    await db.execute(
      sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_plan_id uuid REFERENCES user_plans(id) ON DELETE SET NULL`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS sessions_user_plan_id_index ON sessions USING btree (user_plan_id)`,
    );
    console.log("✓ Column and index created.");
  }

  await client.end();
}

main();
