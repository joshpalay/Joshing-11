/** Offline challengers only. Production imports neither prompt builder. */
export function qualityChallenger(original: string): string {
  const revised = original.replace(/9\. DEFINITION_SUPPLIED[\s\S]*?\n\nA high bar applies/, `9. DEFINITION_SUPPLIED — flag only when the player-visible q= actually states or paraphrases the tested fact and asks the player merely to relabel it. Context that identifies an event or subject is not itself the answer: recalling a name, exact word, translation or other unstated fact still requires topic knowledge. Do not equate a strong clue or a uniquely identifiable subject with supplying the tested fact.
   Quote completion and fill-in-the-blank are legitimate recall. The surrounding quotation, speaker, scene and preceding words are necessary context, not a supplied definition of the missing word. These styles still fail if another part of q= prints or paraphrases the missing answer, or an independent defect is clearly present.
   Keep flagging questions that hand over the tested fact itself, including a dictionary definition at a tier where generic term recall is barred. Preserve all other defects and tier rules.

A high bar applies`);
  if (revised === original) throw new Error('Quality rubric anchor changed; review the challenger before dispatch.');
  return `${revised}

FIELD BOUNDARY AND EVIDENCE:
The player sees ONLY q=. The reference answer a= and routing fields domain=, tier= and fact= are evaluator metadata; their words are not in the question unless they also occur in q=. No answer explanation is provided to this quality check. Do not import remembered explanations, famous quotations or words from metadata into q=.
Before flagging SELF_ANSWERING or ANSWER_LEAKED, quote a short EXACT substring from q= in the reason and explain what answer-bearing content it supplies. Do not invent a quote. If the alleged name/word appears only in a= or fact=, that is not a leak. For DEFINITION_SUPPLIED, identify the tested fact actually supplied by q=, not just the subject narrowed by clues. A true false premise can warrant holding even when the answer is not leaked; use the real defect rather than a fabricated leak reason. Continue checking the other listed defects. Return the same JSON schema.`;
}

export function factualChallenger(original: string): string {
  return `${original}

CLAIM CHECK BEFORE YOUR VERDICT:
Review q= and e= separately. Identify each explicit attribution, identity/title, date/count and causal or temporal claim, then check it even when a= is correct. An explanation that attributes a part/movement/chapter title to the whole work, attributes an existing name to a later person, or asserts a clearly wrong role/relationship is a substantive factual defect, not optional wording polish. Do not waive a known false descriptor just because the keyed answer is right. Do not invent an error from a legitimate alternate title/spelling or reasonable shorthand; retain the high-confidence bar. If a claim is clearly false, hold and name the offending field (q= or e=), the actual claim and its correction. If a claim cannot be verified, do not turn uncertainty into a false assertion. Return the same JSON schema.`;
}
