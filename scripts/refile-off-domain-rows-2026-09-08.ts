import 'dotenv/config';

import { eq } from 'drizzle-orm';

import { db, pool, generatedQuestions } from '../src/server/db';

// Follow-up to scripts/demote-2026-09-07-off-domain-review.ts and
// diagnosis/answer-leak-domain-drift-plan.md's "why does Woolf keep
// generating Joyce" investigation (2026-09-08).
//
// Demoting an OFF_DOMAIN row (is_duplicate=true) does NOT stop it from
// poisoning future generation: getRecentFactKeys / previousQuestionTexts pull
// from GeneratedQuestion regardless of is_duplicate, and render each fact
// tagged `[canonical_subcategory]` into the avoid-list of every future
// generation round for that user. A Joyce fact demoted-but-still-labeled
// "Virginia Woolf's Novels and Essays" keeps teaching the model, every day,
// that this domain covers Joyce material — which is very likely WHY the
// 2026-09-07 sweep found the same pattern recurring for weeks (see the doc).
//
// This script re-derives the CORRECT canonical_subcategory/broad_category
// for every confirmed off-domain row found across the full corpus (not just
// the 22 the 2026-09-07 hand-verify pass caught — this query is broader and
// caught 11 more, including one still LIVE and being served:
// 6bdb3aa5, "Michael Furey", filed under Woolf, is_duplicate=false).
//
// Two outcomes per row, decided by what's SAFE, not just what's correct:
//   - RE-FILE + RESTORE to serving: only when (a) the user has a real,
//     already-established domain matching the true content, AND (b) the
//     row's own verification_reason shows OFF_DOMAIN as the ONLY defect
//     (no FALSE_PREMISE / unsalvageable / duplicate-of-another-row
//     complication). 12 rows qualify.
//   - RELABEL ONLY, stay demoted: everything else — either no existing
//     target domain (Portrait of the Artist, Forster, Rent for users with no
//     Rent domain, Tinctoris), or a real independent content defect besides
//     the filing (cf0a6ed9 unsalvageable answer-leak, 3f191608 + 00afdea4
//     false premise), or an unclear/duplicate history (aad804c5, d21f6b62,
//     ca2c1feb — the last is an explicit dup of 6fb3e187's same fact).
//     Fixing the LABEL on these still closes the avoid-list feedback loop
//     even though the row itself never serves again.
//
// Fallback labels for "no existing domain" cases reuse this exact user's own
// established broad_category-as-domain convention (e.g. this repo already
// files rows under "J.S. Bach & Baroque Counterpoint" as its own top-level
// domain, not just as a broad_category) — not an invented new domain.
//
//   npx tsx -r dotenv/config scripts/refile-off-domain-rows-2026-09-08.ts dotenv_config_path=.env.local            # DRY RUN
//   npx tsx -r dotenv/config scripts/refile-off-domain-rows-2026-09-08.ts dotenv_config_path=.env.local --apply    # writes

const APPLY = process.argv.includes('--apply');

type Row = {
  id: string;
  canonicalSubcategory: string;
  broadCategory: string;
  restore: boolean; // true = also set is_duplicate=false (un-demote)
  note: string;
};

const ROWS: Row[] = [
  // --- User 33da35b1: re-file to "Ulysses (Joyce Novel)" + restore (clean OFF_DOMAIN, no other defect) ---
  { id: 'f8f27ce8-c3ff-4607-ab3d-1235e580156d', canonicalSubcategory: 'Ulysses (Joyce Novel)', broadCategory: 'James Joyce & Irish Modernism', restore: true, note: 'Aeolus rhetoric' },
  { id: '32a587c3-948d-4ec4-816e-47d71eb27cfd', canonicalSubcategory: 'Ulysses (Joyce Novel)', broadCategory: 'James Joyce & Irish Modernism', restore: true, note: 'Oxen of the Sun' },
  { id: '0f464841-159b-4581-ae3e-3a7d5d95fd3b', canonicalSubcategory: 'Ulysses (Joyce Novel)', broadCategory: 'James Joyce & Irish Modernism', restore: true, note: 'Cyclops / Irish Literary Revival' },
  { id: 'b7d9705a-c8a1-42d5-97f5-ef23dcd1fd3c', canonicalSubcategory: 'Ulysses (Joyce Novel)', broadCategory: 'James Joyce & Irish Modernism', restore: true, note: 'Ithaca cocoa' },
  { id: '6fb3e187-1c16-4077-8ce3-b74a273502b2', canonicalSubcategory: 'Ulysses (Joyce Novel)', broadCategory: 'James Joyce & Irish Modernism', restore: true, note: 'Aeolus headlines (kept; ca2c1feb is its dup)' },
  { id: 'b38a6c96-5b47-4cb1-b464-a49bc4a17401', canonicalSubcategory: 'Ulysses (Joyce Novel)', broadCategory: 'James Joyce & Irish Modernism', restore: true, note: 'Sirens' },

  // --- User 33da35b1: re-file to "Dubliners & Joyce's Short Fiction" + restore ---
  { id: '75ab272f-a399-4bdb-ab7c-8a71c9dd813c', canonicalSubcategory: "Dubliners & Joyce's Short Fiction", broadCategory: 'James Joyce & Irish Modernism', restore: true, note: 'Feast of the Epiphany' },
  { id: 'c269be50-17fb-4b32-bb88-e905ec5d1c44', canonicalSubcategory: "Dubliners & Joyce's Short Fiction", broadCategory: 'James Joyce & Irish Modernism', restore: true, note: 'Counterparts' },
  { id: '98bacf63-e577-4f33-81a9-8958631fa823', canonicalSubcategory: "Dubliners & Joyce's Short Fiction", broadCategory: 'James Joyce & Irish Modernism', restore: true, note: 'Eveline' },
  { id: '02a618e2-e3d8-4d78-9cc3-216ff9aa5105', canonicalSubcategory: "Dubliners & Joyce's Short Fiction", broadCategory: 'James Joyce & Irish Modernism', restore: true, note: 'Ivy Day' },
  { id: '08199a4b-71f3-4b8f-b9cf-33e989fc9de5', canonicalSubcategory: "Dubliners & Joyce's Short Fiction", broadCategory: 'James Joyce & Irish Modernism', restore: true, note: 'The Dead' },
  { id: '6bdb3aa5-4d60-49de-910a-0b81a0fe4bcb', canonicalSubcategory: "Dubliners & Joyce's Short Fiction", broadCategory: 'James Joyce & Irish Modernism', restore: true, note: 'Michael Furey — STILL LIVE (is_duplicate=false) under Woolf right now; relabel only, no is_duplicate change needed but harmless to set' },
  { id: 'cf263b0e-7c5f-43d8-9f9f-e187a353a94d', canonicalSubcategory: "Dubliners & Joyce's Short Fiction", broadCategory: 'James Joyce & Irish Modernism', restore: true, note: "Eveline (helpless animal simile) — distinct fact_key from the also-restored 98bacf63's Eveline/Argentina fact, not a duplicate. Missed in the first pass; added after verifying the apply left it behind." },

  // --- User f5ed1c59: re-file to "Rent the Musical" + restore (domain already exists, e.g. 42f619b6) ---
  { id: 'f69900bf-0c27-4bf4-959d-e80b7340352f', canonicalSubcategory: 'Rent the Musical', broadCategory: 'Theater & Musicals', restore: true, note: 'Benny antagonist' },

  // --- Relabel only, stay demoted: no existing target domain for this user ---
  { id: '94093595-9555-42ba-b639-5fc82fe71c30', canonicalSubcategory: 'James Joyce & Irish Modernism', broadCategory: 'James Joyce & Irish Modernism', restore: false, note: '33da35b1 Portrait (lyrical/epical/dramatic) — no per-work domain exists' },
  { id: 'f1064412-93f3-4f7e-9036-2c5670a43a52', canonicalSubcategory: 'James Joyce & Irish Modernism', broadCategory: 'James Joyce & Irish Modernism', restore: false, note: '33da35b1 Portrait (petition) — no per-work domain exists' },
  { id: '2820a8bc-bf66-4017-ad1d-e0ef51a08626', canonicalSubcategory: 'James Joyce & Irish Modernism', broadCategory: 'James Joyce & Irish Modernism', restore: false, note: '33da35b1 Portrait (three nets) — no per-work domain exists' },
  { id: '939c53c7-adb8-4123-94c2-c09e62463e77', canonicalSubcategory: 'James Joyce & Irish Modernism', broadCategory: 'James Joyce & Irish Modernism', restore: false, note: '33da35b1 Portrait (claritas) — original source of the 815b3ad8 bank-pick clone' },
  { id: '139e1932-d4e4-4fc6-9f78-53a05cecadfe', canonicalSubcategory: '20th Century English Modernist Literature', broadCategory: '20th Century English Modernist Literature', restore: false, note: "f5ed1c59 Portrait (petition) — the ORIGINAL flagged incident row; no per-work domain, mirrors this user's own Ulysses broad_category" },
  { id: '815b3ad8-3b54-4c64-a102-0854f223bcc3', canonicalSubcategory: '20th Century English Modernist Literature', broadCategory: '20th Century English Modernist Literature', restore: false, note: 'f5ed1c59 Portrait (claritas) — bank-pick clone of 939c53c7' },
  { id: 'fd246545-63a6-490a-aaca-6990b83328c0', canonicalSubcategory: "E.M. Forster's Howards End", broadCategory: 'Literature', restore: false, note: '30c4be4b Forster — no Forster domain exists for this user' },
  { id: '4b686fbd-c75f-44cb-909b-7ec670f8cd7c', canonicalSubcategory: "E.M. Forster's Howards End", broadCategory: 'Literature', restore: false, note: 'f5ed1c59 Forster — no Forster domain exists for this user' },
  { id: '3cdabe19-a095-42f0-ae95-61b102456535', canonicalSubcategory: 'Rent (Jonathan Larson Musical)', broadCategory: 'Theater & Musicals', restore: false, note: '30c4be4b Rent — no Rent domain exists for this user' },
  { id: '0f713f93-f0e8-4ad3-8ec6-504507dbcbbb', canonicalSubcategory: 'Rent (Jonathan Larson Musical)', broadCategory: 'Theater & Musicals', restore: false, note: '30c4be4b Rent (seasons of love) — no Rent domain, unclear prior demotion reason' },
  { id: '81d53628-4707-418e-b244-92696b92abf7', canonicalSubcategory: 'Rent (Jonathan Larson Musical)', broadCategory: 'Theater & Musicals', restore: false, note: '30c4be4b Rent (Mimi/Roger) — no Rent domain exists for this user' },
  { id: '00afdea4-d4f8-4066-bb50-14be796f80aa', canonicalSubcategory: 'Rent (Jonathan Larson Musical)', broadCategory: 'Theater & Musicals', restore: false, note: '30c4be4b Rent (Angel/drums) — ALSO has an independent FALSE_PREMISE defect; stays demoted regardless' },
  { id: '072b5c66-b0cf-4fb6-af3b-522fc2ef01fb', canonicalSubcategory: 'Rent (Jonathan Larson Musical)', broadCategory: 'Theater & Musicals', restore: false, note: '565e41bd Rent — no Rent domain exists for this user' },
  { id: '19c7961f-c16f-4cd6-8eee-88f47f375408', canonicalSubcategory: 'Renaissance Counterpoint (Johannes Tinctoris)', broadCategory: 'Music', restore: false, note: 'f5ed1c59 Tinctoris — no Renaissance/polyphony domain exists for this user (Bach ≠ Tinctoris by ~250 years)' },
  { id: 'cf0a6ed9-ee5b-4095-9994-86f95ee8272f', canonicalSubcategory: "Dubliners & Joyce's Short Fiction", broadCategory: 'James Joyce & Irish Modernism', restore: false, note: "33da35b1 Araby — has an independent UNSALVAGEABLE answer-leak defect (bazaar name = story title); relabel for accuracy only, never serve" },
  { id: '3f191608-e026-4970-a535-36139c999b45', canonicalSubcategory: "Dubliners & Joyce's Short Fiction", broadCategory: 'James Joyce & Irish Modernism', restore: false, note: '33da35b1 Dubliners (Catholic Church) — ALSO has an independent FALSE_PREMISE defect; stays demoted regardless' },
  { id: 'aad804c5-ca0c-4a81-a675-860d1fc76bf6', canonicalSubcategory: 'Ulysses (Joyce Novel)', broadCategory: 'James Joyce & Irish Modernism', restore: false, note: '33da35b1 Ulysses (Shakespeare & Co) — verdict/reason unclear (verified/ok but is_duplicate=true already); relabel only, do not risk restoring a possible duplicate' },
  { id: 'd21f6b62-ffbd-4239-a4e6-6f400044a65c', canonicalSubcategory: 'Ulysses (Joyce Novel)', broadCategory: 'James Joyce & Irish Modernism', restore: false, note: '33da35b1 Ulysses (June 16 1904) — reason/verdict null; relabel only, do not risk restoring a possible duplicate' },
  { id: 'ca2c1feb-ee78-4b81-8db4-e33501e507c6', canonicalSubcategory: 'Ulysses (Joyce Novel)', broadCategory: 'James Joyce & Irish Modernism', restore: false, note: '33da35b1 Ulysses (Aeolus headlines) — explicit duplicate of the restored 6fb3e187; relabel only' },
];

async function main() {
  const restoring = ROWS.filter((r) => r.restore).length;
  console.log(
    `[refile] ${ROWS.length} rows to relabel (${restoring} also restored to serving)${APPLY ? '' : ' (DRY RUN)'}`,
  );
  if (!APPLY) {
    for (const r of ROWS) {
      console.log(`  ${r.id} -> "${r.canonicalSubcategory}" (${r.broadCategory})${r.restore ? ' [RESTORE]' : ''} — ${r.note}`);
    }
    console.log('[refile] re-run with --apply to write.');
    return;
  }

  const now = new Date();
  let n = 0;
  for (const r of ROWS) {
    // Restored rows get a fresh, clean verdict — they're back in circulation.
    // Relabel-only rows keep their ORIGINAL verification_reason untouched
    // (the audit trail for why they're demoted, e.g. an independent
    // unsalvageable-answer-leak or false-premise finding) — only the
    // domain label is wrong there, not the verdict, so only
    // canonical_subcategory/broad_category change.
    const patch: Partial<typeof generatedQuestions.$inferInsert> = r.restore
      ? {
          canonicalSubcategory: r.canonicalSubcategory,
          broadCategory: r.broadCategory,
          isDuplicate: false,
          verificationVerdict: 'ok',
          verifiedAt: now,
          verificationReason: `re-filed 2026-09-08 (was OFF_DOMAIN): ${r.note}`.slice(0, 400),
        }
      : {
          canonicalSubcategory: r.canonicalSubcategory,
          broadCategory: r.broadCategory,
        };
    const updated = await db
      .update(generatedQuestions)
      .set(patch)
      .where(eq(generatedQuestions.id, r.id))
      .returning({ id: generatedQuestions.id });
    n += updated.length;
  }
  console.log(`[refile] updated ${n} row(s).`);
}

main()
  .catch((err) => {
    console.error('[refile] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
