/**
 * Plain-sentence copy for friend news (see getFriendNews). NO database imports —
 * the cron routes run the queries and feed the results here, so every line the
 * text, the daily email, and the weekly email can say is unit-testable.
 *
 * Register: quiet and people-first. Never a count of what someone got WRONG on
 * its own — a miss is only ever mentioned inside a total ("answered 3, got 2"),
 * and never "finally", "again", or anything that reads as a scoreboard.
 */

import type { FriendNews } from '@/server/db/queries/friend-news';
import type { QueueSlot } from '@/server/daily/types';

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} ${plural(names.length - 2, 'other', 'others')}`;
}

/**
 * Friends who wrote one of today's unanswered slots, de-duplicated in slot
 * order. Only `source: 'friend'` slots carry a real author (house questions
 * say 'Joshing' and have no author_id).
 */
export function friendAuthorsInSlots(slots: QueueSlot[], viewerId: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const slot of slots) {
    if (slot.answered || slot.skipped) continue;
    if (slot.source !== 'friend' || !slot.author_id || slot.author_id === viewerId) continue;
    const name = slot.author_name?.trim();
    if (!name || seen.has(slot.author_id)) continue;
    seen.add(slot.author_id);
    out.push(name);
  }
  return out;
}

function answeredLine(news: FriendNews): string | null {
  const people = news.answeredYourQuestions;
  if (people.length === 0) return null;
  if (people.length === 1) {
    const [p] = people;
    return p.total === 1
      ? `${p.name} answered one of your questions.`
      : `${p.name} answered ${p.total} of your questions.`;
  }
  return `${joinNames(people.map((p) => p.name))} answered your questions.`;
}

function invitedLine(news: FriendNews): string | null {
  if (news.invitedStarted.length === 0) return null;
  const who = joinNames(news.invitedStarted.map((p) => p.name));
  return `${who} just played ${plural(news.invitedStarted.length, 'a first', 'their first')} five. Your invite worked.`;
}

// Someone said yes to YOUR request. Otherwise this news only reaches the bell,
// which some players never open (Sadie → Chiann, 2026-10-09).
function acceptedLine(news: FriendNews): string | null {
  const people = news.acceptedYourRequest;
  if (people.length === 0) return null;
  return `${joinNames(people.map((p) => p.name))} said yes to your friend ${plural(people.length, 'request', 'requests')}.`;
}

// New friends not already named by acceptedLine.
function newFriendsLine(news: FriendNews): string | null {
  const accepted = new Set(news.acceptedYourRequest.map((p) => p.friendId));
  const people = news.newFriends.filter((p) => !accepted.has(p.friendId));
  if (people.length === 0) return null;
  return `You and ${joinNames(people.map((p) => p.name))} are now friends.`;
}

function todaysFiveLine(authors: string[]): string | null {
  if (authors.length === 0) return null;
  return authors.length === 1
    ? `${authors[0]} wrote one of today's five.`
    : `${joinNames(authors)} wrote some of today's five.`;
}

/**
 * The ONE line the daily text may add, or null for the plain reminder. Order is
 * "most personal first": someone saying yes to your friend request (news you
 * are waiting on), an invite that stuck, then your own questions being
 * answered, then a friend's question waiting today, then a new friend.
 */
export function smsFriendLine(news: FriendNews, todaysFriendAuthors: string[]): string | null {
  return (
    acceptedLine(news) ??
    invitedLine(news) ??
    answeredLine(news) ??
    todaysFiveLine(todaysFriendAuthors) ??
    newFriendsLine(news)
  );
}

/** Up to three lines for the daily email's MEANWHILE section. */
export function dailyEmailFriendLines(
  news: FriendNews,
  todaysFriendAuthors: string[],
): string[] {
  return [
    acceptedLine(news),
    invitedLine(news),
    answeredLine(news),
    todaysFiveLine(todaysFriendAuthors),
    newFriendsLine(news),
  ]
    .filter((line): line is string => Boolean(line))
    .slice(0, 3);
}

export type WeeklyDigestSection = { heading: string; lines: string[] };

/**
 * The weekly email body, one section per kind of news, empty sections dropped.
 * An empty array means "nothing happened this week" — the caller skips the send
 * rather than mailing an empty note.
 */
export function weeklyDigestSections(news: FriendNews): WeeklyDigestSection[] {
  const sections: WeeklyDigestSection[] = [];

  if (news.answeredYourQuestions.length > 0) {
    sections.push({
      heading: 'Your questions',
      lines: news.answeredYourQuestions.slice(0, 6).map((p) =>
        p.total === 1
          ? p.correct === 1
            ? `${p.name} answered one and got it.`
            : `${p.name} answered one.`
          : `${p.name} answered ${p.total} and got ${p.correct}.`,
      ),
    });
  }

  if (news.newQuestionsFromFriends.length > 0) {
    sections.push({
      heading: 'Waiting for you',
      lines: news.newQuestionsFromFriends.slice(0, 6).map((p) =>
        p.count === 1
          ? `${p.name} wrote a new question.`
          : `${p.name} wrote ${p.count} new questions.`,
      ),
    });
  }

  const people = [
    ...news.invitedStarted.map((p) => `${p.name} started playing. Your invite worked.`),
    ...news.newFriends.map((p) => `You and ${p.name} are now friends.`),
  ];
  if (people.length > 0) {
    sections.push({ heading: 'New faces', lines: people.slice(0, 6) });
  }

  return sections;
}
