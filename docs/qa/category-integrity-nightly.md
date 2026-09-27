# Nightly category integrity check

`.github/workflows/category-integrity-nightly.yml` runs at 05:00 UTC and can
also be dispatched manually. It runs the analyzer's unit test, then executes
`npm run check:category-integrity -- --summary`. Configure the repository
secret `CATEGORY_DIAGNOSTIC_DATABASE_URL` with a **read-only database role**
before expecting the scheduled run to pass. The workflow intentionally fails
when the secret is missing. It prints aggregate counts only; category names
and player data are not uploaded to GitHub.

The database script opens a repeatable-read, read-only transaction with a
30-second statement timeout. A nonzero exit means a graph node has a stale
key, an edge points to a missing node, the graph contains a cycle, or a Tidy
merge in the past 24 hours moved an authored graph topic to a different key.
Exact-key spelling splits and bank-key mismatches are reported for review but
do not fail the run; older rows may have null bank keys.

Run `npm run check:category-integrity` locally with `DATABASE_URL` to see the
specific labels behind the counts. Treat these as private diagnostic data.
The report also shows how many applied Tidy merges had their AI target
replaced. Skipped suggestions are logged by the application as
`[tidy] merge suggestion skipped`; they are **not** in the database report,
so `unavailable_from_database` must not be interpreted as zero. A durable
counter or log export is needed before skipped-suggestion rates can be used
to judge whether to expand Tidy's name rules.

On 2026-09-27, a read-only production run found 137 nodes, 109 edges, no
broken edges or cycles, four actionable same-key spelling groups, three bank
key mismatches, and five Tidy merges in the previous 24 hours that moved an
authored graph topic into another key. These are existing data to review,
not instructions for the nightly job to repair automatically.
