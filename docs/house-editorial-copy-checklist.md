# House / Editorial author — commentary copy checklist (D-3 §E)

The house author (`Joshing` / `Editorial`, `HOUSE_AUTHOR` in
`src/lib/questions-types.ts`) is **content infrastructure, not a peer**. Its
creator-notes/asides may have voice and personality, but they must read as an
**editor or curator**, never as a friend who has a relationship with the reader.

This is a **content/review guideline, enforced in authoring and PR review — not a
runtime validation gate.** The render layer already strips relational *chrome*
for house questions (no "gave you this", no "Why {name} asked", no
"{name} carries this one" — see `AuthorNoteCard` / `QuestionRow` in
`src/components/play/GameplayChat.tsx` and the summary "Editor's note:"), but the
note *text itself* is human-written and must follow this checklist.

## Reviewing a house creator-note / aside — checklist

- [ ] **No relational framing.** Reject anything that implies a peer
      relationship with the reader: "between us friends", "just for you", "our
      little secret", "I picked this for you", "you and I", "trust me", etc.
- [ ] **No simulated personal history or feelings toward the reader.** The house
      author has not met the player and shares no in-jokes with them.
- [ ] **Editorial / curator voice only.** Allowed: "A favorite from the
      archives.", "One the whole table usually trips on.", "Worth knowing if you
      like the deep cuts." — asides *about the question or the domain*, not about
      a relationship.
- [ ] **First person is fine if it's an editor's voice**, not a friend's: "We
      love this one" (editorial we) is OK; "Just between us" is not.
- [ ] **No follow / social hooks.** The note must not invite following,
      messaging, or any peer affordance — the house author is never followable.

## Why this matters

The whole house concept rests on one line: *a labeled non-human author that fills
content is fine; a non-human pretending to be a peer who connects with you is
forbidden.* Relational copy on house content crosses exactly that line, so it is
the one thing a house note can get wrong even when every render-layer guard is
correct.
