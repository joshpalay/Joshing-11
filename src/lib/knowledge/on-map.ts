// Whether a topic belongs on a player's map: it has earned points, or the
// player added it — the same own-map rule getKnowledgeMapData applies to the
// knowledge tree. Used by the topic circles on /knowledge and /daily/setup and
// on a friend's knowledge page.
//
// getKnowledgePageData also returns topics the player has only ANSWERED a
// question in (MASTERY_EVENTS) with no points and no add — a wrong From Friends
// answer, or a bonus whose "Add {topic} to your topics?" got "Not now". Those
// must not render as held topics: they showed as "0 pts · Sometimes" on the
// topics screen although nothing ever served them (QA 2026-10-01 run 2).
// Visibility (private topics) is the caller's call: an owner still sees their
// own hidden topics, a viewer does not.
export function isOnMap(domain: { points: number; isDeclared: boolean }): boolean {
  return domain.points > 0 || domain.isDeclared;
}
