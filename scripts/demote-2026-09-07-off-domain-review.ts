import 'dotenv/config';

import { inArray } from 'drizzle-orm';

import { db, pool, generatedQuestions } from '../src/server/db';
import { verdictToGeneratedPatch } from '../src/server/quality/verify-question';

// One-off, hand-verified demotion of the 24 OFF_DOMAIN hits the 2026-09-07 bank
// sweep found but did not act on (scripts/sweep-bank-quality.ts requires
// --include-off-domain, since that gate's precision hadn't been checked yet).
//
// Every one of these 24 was individually cross-checked against its stored
// fact_key before this list was written — NOT taken on the gate's say-so alone.
// That check caught a REAL false positive the gate produced:
//
//   bc1f47f0-993a-4ae0-8d03-d88389702ba2  domain=Mozart
//   fact_key="mozart-clarinet-concerto-basset-clarinet" — correctly filed.
//   The gate's own reason text even said "belongs to the domain 'Mozart'
//   (correctly filed), but the fact_key ..." and then flagged it anyway.
//   EXCLUDED from this list.
//
// One more is held back as genuinely ambiguous rather than a clean miss:
//
//   e6a64867-c0c3-404f-a56f-621215e47b1b  domain="Well-Tempered Clavier"
//   fact_key="wtc-glenn-gould-recording-legacy" — the "wtc-" prefix suggests
//   this row was generated FOR that domain on purpose (Gould's WTC recordings
//   are why the fact belongs there), not a stray off-domain drift. Same shape
//   as the Romantic Opera / Romantic Era Orchestral Music miss in the Phase 2
//   eval (diagnosis doc) — a defensible non-flag on an adjacent case, not
//   obviously wrong. EXCLUDED from this list; left servable.
//
// The remaining 22 are unambiguous: 16 James Joyce + 2 E.M. Forster rows filed
// under "Virginia Woolf's Novels and Essays" (Joyce/Forster are Woolf's
// CONTEMPORARIES, not part of her body of work — several are duplicate
// re-generations of the same underlying fact), plus 3 duplicate "Rent"
// (Jonathan Larson) rows filed under "Stephen Sondheim Musicals", plus one
// Johannes Tinctoris (15th-c. Renaissance treatise) row filed under
// "J.S. Bach & Baroque Counterpoint" (a different composer, a different
// century). Every fact_key was read and confirms the mismatch.
//
// See diagnosis/answer-leak-domain-drift-plan.md for the full spot-check.
//
//   npx tsx scripts/demote-2026-09-07-off-domain-review.ts            # DRY RUN
//   npx tsx scripts/demote-2026-09-07-off-domain-review.ts --apply    # writes

const APPLY = process.argv.includes('--apply');

const ROWS: { id: string; reason: string }[] = [
  { id: 'b7d9705a-c8a1-42d5-97f5-ef23dcd1fd3c', reason: "OFF_DOMAIN: James Joyce's Ulysses ('Ithaca' cocoa), filed under Virginia Woolf's Novels and Essays" },
  { id: 'f8f27ce8-c3ff-4607-ab3d-1235e580156d', reason: "OFF_DOMAIN: James Joyce's Ulysses ('Aeolus' rhetoric), filed under Virginia Woolf's Novels and Essays" },
  { id: '3cdabe19-a095-42f0-ae95-61b102456535', reason: "OFF_DOMAIN: 'Rent' (Jonathan Larson) filed under Stephen Sondheim Musicals" },
  { id: '815b3ad8-3b54-4c64-a102-0854f223bcc3', reason: "OFF_DOMAIN: James Joyce's Portrait of the Artist (claritas), filed under Virginia Woolf's Novels and Essays" },
  { id: '19c7961f-c16f-4cd6-8eee-88f47f375408', reason: 'OFF_DOMAIN: Johannes Tinctoris (15th-c. Renaissance treatise), filed under J.S. Bach & Baroque Counterpoint' },
  { id: 'fd246545-63a6-490a-aaca-6990b83328c0', reason: "OFF_DOMAIN: E.M. Forster's Howards End, filed under Virginia Woolf's Novels and Essays" },
  { id: '32a587c3-948d-4ec4-816e-47d71eb27cfd', reason: "OFF_DOMAIN: James Joyce's Ulysses ('Oxen of the Sun'), filed under Virginia Woolf's Novels and Essays" },
  { id: 'f69900bf-0c27-4bf4-959d-e80b7340352f', reason: "OFF_DOMAIN: 'Rent' (Jonathan Larson) filed under Stephen Sondheim Musicals" },
  { id: '4b686fbd-c75f-44cb-909b-7ec670f8cd7c', reason: "OFF_DOMAIN: E.M. Forster's Howards End, filed under Virginia Woolf's Novels and Essays" },
  { id: '072b5c66-b0cf-4fb6-af3b-522fc2ef01fb', reason: "OFF_DOMAIN: 'Rent' (Jonathan Larson) filed under Stephen Sondheim Musicals" },
  { id: '939c53c7-adb8-4123-94c2-c09e62463e77', reason: "OFF_DOMAIN: James Joyce's Portrait of the Artist (claritas), filed under Virginia Woolf's Novels and Essays" },
  { id: 'c269be50-17fb-4b32-bb88-e905ec5d1c44', reason: "OFF_DOMAIN: James Joyce's Dubliners ('Counterparts'), filed under Virginia Woolf's Novels and Essays" },
  { id: '98bacf63-e577-4f33-81a9-8958631fa823', reason: "OFF_DOMAIN: James Joyce's Dubliners ('Eveline'), filed under Virginia Woolf's Novels and Essays" },
  { id: '75ab272f-a399-4bdb-ab7c-8a71c9dd813c', reason: "OFF_DOMAIN: James Joyce's Dubliners (Feast of the Epiphany), filed under Virginia Woolf's Novels and Essays" },
  { id: '2820a8bc-bf66-4017-ad1d-e0ef51a08626', reason: "OFF_DOMAIN: James Joyce's Portrait of the Artist (three nets), filed under Virginia Woolf's Novels and Essays" },
  { id: '0f464841-159b-4581-ae3e-3a7d5d95fd3b', reason: "OFF_DOMAIN: James Joyce's Ulysses ('Cyclops'), filed under Virginia Woolf's Novels and Essays" },
  { id: '02a618e2-e3d8-4d78-9cc3-216ff9aa5105', reason: "OFF_DOMAIN: James Joyce's Dubliners ('Ivy Day'), filed under Virginia Woolf's Novels and Essays" },
  { id: '6fb3e187-1c16-4077-8ce3-b74a273502b2', reason: "OFF_DOMAIN: James Joyce's Ulysses ('Aeolus' headlines), filed under Virginia Woolf's Novels and Essays" },
  { id: 'ca2c1feb-ee78-4b81-8db4-e33501e507c6', reason: "OFF_DOMAIN: James Joyce's Ulysses ('Aeolus' headlines, dup), filed under Virginia Woolf's Novels and Essays" },
  { id: '08199a4b-71f3-4b8f-b9cf-33e989fc9de5', reason: "OFF_DOMAIN: James Joyce's 'The Dead', filed under Virginia Woolf's Novels and Essays" },
  { id: '94093595-9555-42ba-b639-5fc82fe71c30', reason: "OFF_DOMAIN: James Joyce's Portrait of the Artist (three forms of art), filed under Virginia Woolf's Novels and Essays" },
  { id: 'b38a6c96-5b47-4cb1-b464-a49bc4a17401', reason: "OFF_DOMAIN: James Joyce's Ulysses ('Sirens'), filed under Virginia Woolf's Novels and Essays" },
];

async function main() {
  console.log(`[demote] ${ROWS.length} hand-verified off-domain rows${APPLY ? '' : ' (DRY RUN)'}`);
  if (!APPLY) {
    console.log('[demote] re-run with --apply to write.');
    return;
  }
  const patched = ROWS.map((r) => ({ id: r.id, patch: verdictToGeneratedPatch('demoted', new Date(), `bank sweep: ${r.reason}`.slice(0, 400)) }));
  let n = 0;
  for (const { id, patch } of patched) {
    const updated = await db
      .update(generatedQuestions)
      .set(patch)
      .where(inArray(generatedQuestions.id, [id]))
      .returning({ id: generatedQuestions.id });
    n += updated.length;
  }
  console.log(`[demote] demoted ${n} row(s).`);
}

main()
  .catch((err) => {
    console.error('[demote] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
