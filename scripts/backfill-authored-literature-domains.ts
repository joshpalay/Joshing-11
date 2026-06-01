import 'dotenv/config';
import { Pool } from 'pg';

const QUESTION_IDS = [process.env.QUESTION_ID_1, process.env.QUESTION_ID_2].filter(
  Boolean,
) as string[];
const USER_ID = process.env.USER_ID;

type QuestionRow = {
  id: string;
  creator_id: string;
  question_text: string;
  answer_text: string;
  category: string | null;
  broad_category: string | null;
  subcategory: string | null;
  canonical_subcategory: string | null;
  category_overridden: boolean | null;
  sharedToFriendsFeed: boolean | null;
  created_at: Date;
};

function inferLiteratureDomain(row: QuestionRow): string {
  const combined = `${row.question_text} ${row.answer_text}`.toLowerCase();
  if (
    combined.includes('waste land') ||
    combined.includes('cruelest month') ||
    combined.includes('cruellest month')
  ) {
    return 'The Waste Land';
  }
  if (combined.includes('four quartets')) return 'Four Quartets';
  if (combined.includes('eliot') || combined.includes('prufrock')) return 'T. S. Eliot';
  if (combined.includes('modernist') || combined.includes('modernism')) return 'Modernist Poetry';
  return 'T. S. Eliot';
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  if (QUESTION_IDS.length === 0 && !USER_ID) {
    throw new Error(
      'Set QUESTION_ID_1 and QUESTION_ID_2, or set USER_ID to update the two most recent authored questions for that user.',
    );
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const questions =
      QUESTION_IDS.length > 0
        ? (
            await pool.query<QuestionRow>(
              `
          SELECT id, creator_id, question_text, answer_text, category, broad_category, subcategory,
                 canonical_subcategory, category_overridden, "sharedToFriendsFeed", created_at
          FROM "Question"
          WHERE id = ANY($1::text[])
          ORDER BY created_at DESC
        `,
              [QUESTION_IDS],
            )
          ).rows
        : (
            await pool.query<QuestionRow>(
              `
          SELECT id, creator_id, question_text, answer_text, category, broad_category, subcategory,
                 canonical_subcategory, category_overridden, "sharedToFriendsFeed", created_at
          FROM "Question"
          WHERE creator_id = $1 AND deleted_at IS NULL
          ORDER BY created_at DESC
          LIMIT 2
        `,
              [USER_ID],
            )
          ).rows;

    console.table(
      questions.map((row) => ({
        id: row.id,
        creator_id: row.creator_id,
        question_text: row.question_text,
        category: row.category,
        broad_category: row.broad_category,
        subcategory: row.subcategory,
        canonical_subcategory: row.canonical_subcategory,
        category_overridden: row.category_overridden,
        sharedToFriendsFeed: row.sharedToFriendsFeed,
        created_at: row.created_at,
      })),
    );

    for (const row of questions) {
      const canonical = inferLiteratureDomain(row);
      await pool.query('BEGIN');
      try {
        await pool.query(
          `
          UPDATE "Question"
          SET category = 'literature'::"Category",
              broad_category = 'Literature',
              subcategory = $2,
              canonical_subcategory = $2,
              category_overridden = true,
              updated_at = now()
          WHERE id = $1
        `,
          [row.id, canonical],
        );

        await pool.query(
          `
          INSERT INTO "PLAYER_MASTERY" (
            id, user_id, canonical_subcategory, broad_category, total_points, tier,
            season_points_start, territory_type, updated_at
          )
          VALUES (gen_random_uuid()::text, $1, $2, 'Literature', 0, 'establishing', 0, 'declared', now())
          ON CONFLICT (user_id, canonical_subcategory) DO UPDATE
          SET broad_category = COALESCE("PLAYER_MASTERY".broad_category, EXCLUDED.broad_category),
              territory_type = CASE
                WHEN "PLAYER_MASTERY".territory_type = 'demonstrated' THEN 'demonstrated'
                ELSE 'declared'
              END,
              updated_at = now()
        `,
          [row.creator_id, canonical],
        );

        await pool.query(
          `
          UPDATE "MASTERY_EVENTS"
          SET canonical_subcategory = $2
          WHERE question_id = $1
            AND canonical_subcategory IN ('literature', 'Literature')
        `,
          [row.id, canonical],
        );

        await pool.query('COMMIT');
        console.log(`Backfilled ${row.id} -> ${canonical}`);
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
