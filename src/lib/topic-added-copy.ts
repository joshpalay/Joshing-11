// The confirmation shown after POST /api/declared-interests, shared by every
// "add a topic" surface so they can't drift apart.
//
// `restored` means the add lifted a "Remove from your map" exclusion: the topic
// comes back with the points it kept. That used to read "already in your
// topics" — true of the declared row, wrong about what just happened
// (QA 2026-10-01, S6).
export type AddedTopic = { domain: string; created: boolean; restored?: boolean };

export function addedTopicMessage({ domain, created, restored }: AddedTopic): string {
  if (restored) return `“${domain}” is back on your map — the points you’d earned are still there.`;
  if (created) return `Added “${domain}” — it’ll show up in an upcoming round.`;
  return `“${domain}” is already in your topics.`;
}
