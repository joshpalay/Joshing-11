export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { Pool } = await import('pg');
    const path = await import('path');

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = drizzle(pool);

    await migrate(db, {
      migrationsFolder: path.join(process.cwd(), 'drizzle'),
    });

    await pool.end();
  }
}
