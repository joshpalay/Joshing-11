-- D-5 question-quality before/after sample.
-- Boundary: 2026-06-04 (the day B1–B5 shipped — see PRD-D-5 §11 build log).
-- "before" = rows generated pre-ship; "after" = rows generated post-ship.
-- D8 ("no decay") means pre-ship rows still exist, so the before side is intact.
--
-- Run:  psql "$DATABASE_URL" -f scripts/d5-before-after-sample.sql
-- (read-only; safe against prod)

\set boundary '2026-06-04'

-- 1) Aggregate metrics, before vs after -------------------------------------
WITH tagged AS (
  SELECT
    CASE WHEN created_at < :'boundary' THEN 'before' ELSE 'after' END AS era,
    question_text,
    difficulty_estimate,
    trust_tier,
    ask_to_answer_verified,
    jsonb_array_length(source_refs)            AS n_sources,
    n_answered,
    empirical_correct_rate
  FROM "GeneratedQuestion"
)
SELECT
  era,
  count(*)                                                              AS n,
  -- Register / "trivia-of-trivia" rate (D4): recognition-trivia heuristic.
  round(100.0 * avg((question_text ~* '(what|which|in what|in which) +year'
                   OR question_text ~* 'what (number|date|year)'
                   OR question_text ~* 'in what year')::int), 1)        AS pct_year_trivia,
  -- Source-backing (B3): share with >=1 stored source_ref.
  round(100.0 * avg((n_sources > 0)::int), 1)                          AS pct_source_backed,
  round(avg(n_sources), 2)                                             AS avg_sources,
  -- Verification (B4): ask-to-answer corroboration rate.
  round(100.0 * avg(ask_to_answer_verified::int), 1)                   AS pct_a2a_verified
FROM tagged
GROUP BY era
ORDER BY era DESC;  -- before, after

-- 2) Difficulty-floor distribution, before vs after (D2/D3) ------------------
SELECT
  CASE WHEN created_at < :'boundary' THEN 'before' ELSE 'after' END AS era,
  difficulty_estimate,
  count(*) AS n
FROM "GeneratedQuestion"
GROUP BY 1, 2
ORDER BY 1 DESC, 3 DESC;

-- 3) Trust-tier distribution, before vs after (§6) ---------------------------
SELECT
  CASE WHEN created_at < :'boundary' THEN 'before' ELSE 'after' END AS era,
  trust_tier,
  count(*) AS n
FROM "GeneratedQuestion"
GROUP BY 1, 2
ORDER BY 1 DESC, 3 DESC;

-- 4) Eyeball sample — 20 random questions per era ---------------------------
(SELECT 'before' AS era, difficulty_estimate, trust_tier,
        jsonb_array_length(source_refs) AS n_src, question_text
   FROM "GeneratedQuestion" WHERE created_at <  :'boundary'
   ORDER BY random() LIMIT 20)
UNION ALL
(SELECT 'after'  AS era, difficulty_estimate, trust_tier,
        jsonb_array_length(source_refs) AS n_src, question_text
   FROM "GeneratedQuestion" WHERE created_at >= :'boundary'
   ORDER BY random() LIMIT 20)
ORDER BY era DESC;
