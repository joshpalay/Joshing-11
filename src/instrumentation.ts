export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { Pool } = await import('pg');
    const { sql } = await import('drizzle-orm');
    const path = await import('path');

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = drizzle(pool);

    // Migration 0006 sets NOT NULL on senderUserId/recipientUserId after adding them
    // as nullable columns. If any rows have NULL values (from a partial migration or
    // data predating those columns), the SET NOT NULL fails and blocks all subsequent
    // migrations. Delete those structurally-invalid rows first so 0006 can succeed.
    try {
      await db.execute(sql`
        DELETE FROM "QuestionReaction"
        WHERE "senderUserId" IS NULL OR "recipientUserId" IS NULL
      `);
    } catch {
      // Table or columns may not exist yet — that's fine, migrate() will create them
    }

    try {
      await migrate(db, {
        migrationsFolder: path.join(process.cwd(), 'drizzle'),
      });
    } catch (err) {
      console.error('[instrumentation] DB migration failed — server will start but schema may be out of date:', err);
    } finally {
      await pool.end();
    }
  }
}
