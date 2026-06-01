import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RelationshipState } from '@/server/db/queries/friend-requests';

// notifyNicheMatch only reaches out to three collaborators: getRelationship
// (the stranger gate), getNicheMatchDiscoverable (the asymmetric flag gate),
// and writeActivity (the two writes). We mock exactly those and assert on the
// resulting writeActivity calls. '@/server/db' is mocked to keep the module's
// top-level table/pool imports from initializing a real connection.
const { writeActivityMock, getRelationshipMock, getNicheMatchDiscoverableMock } = vi.hoisted(() => ({
  writeActivityMock: vi.fn(async () => undefined),
  getRelationshipMock: vi.fn(),
  getNicheMatchDiscoverableMock: vi.fn(),
}));

vi.mock('@/server/db', () => ({
  db: {},
  feedDismissedDomains: {},
  feedItems: {},
  masteryEvents: {},
  questionFeedback: {},
  questionRatings: {},
  questions: {},
}));

vi.mock('@/server/activity/write-activity', () => ({ writeActivity: writeActivityMock }));
vi.mock('@/server/db/queries/friend-requests', () => ({ getRelationship: getRelationshipMock }));
vi.mock('@/server/db/queries/account', () => ({ getNicheMatchDiscoverable: getNicheMatchDiscoverableMock }));

import { notifyNicheMatch } from '@/server/feed/create-feed-items-for-answer';

const ANSWERER = 'answerer-1';
const AUTHOR = 'author-1';
const QUESTION = 'question-1';

function relationship(state: RelationshipState) {
  return { state, friendshipId: null, formedAt: null, isBlocked: false };
}

// optedIn is the set the gate consults; default both parties opted in (the
// test-phase DEFAULT-ON posture).
function bothOptedIn() {
  return new Set([ANSWERER, AUTHOR]);
}

beforeEach(() => {
  vi.clearAllMocks();
  getRelationshipMock.mockResolvedValue(relationship('none'));
  getNicheMatchDiscoverableMock.mockResolvedValue(bothOptedIn());
});

describe('notifyNicheMatch — stranger gate', () => {
  it('writes exactly two rows for a correct stranger answer when both parties are opted in', async () => {
    await notifyNicheMatch(ANSWERER, QUESTION, AUTHOR);

    expect(writeActivityMock).toHaveBeenCalledTimes(2);
    // Author-side: the AUTHOR is told a stranger (the answerer) answered.
    expect(writeActivityMock).toHaveBeenCalledWith({
      userId: AUTHOR,
      type: 'niche_match_answered_your_question',
      actorUserId: ANSWERER,
      referenceId: QUESTION,
      referenceType: 'question',
    });
    // Answerer-side: the ANSWERER is told they answered a stranger's (author's) question.
    expect(writeActivityMock).toHaveBeenCalledWith({
      userId: ANSWERER,
      type: 'niche_match_you_answered',
      actorUserId: AUTHOR,
      referenceId: QUESTION,
      referenceType: 'question',
    });
  });

  it.each<RelationshipState>([
    'friends',
    'following',
    'follows_you',
    'pending_outbound',
    'pending_inbound',
  ])('writes nothing when the relationship is %s (not a stranger)', async (state) => {
    getRelationshipMock.mockResolvedValue(relationship(state));

    await notifyNicheMatch(ANSWERER, QUESTION, AUTHOR);

    expect(writeActivityMock).not.toHaveBeenCalled();
  });

  it('writes nothing when the answerer is the author (self)', async () => {
    await notifyNicheMatch(AUTHOR, QUESTION, AUTHOR);

    expect(getRelationshipMock).not.toHaveBeenCalled();
    expect(writeActivityMock).not.toHaveBeenCalled();
  });

  it('writes nothing for an LLM-origin question with no author (null creatorId)', async () => {
    await notifyNicheMatch(ANSWERER, QUESTION, null);

    expect(getRelationshipMock).not.toHaveBeenCalled();
    expect(writeActivityMock).not.toHaveBeenCalled();
  });

  it('writes nothing for joshing-games (excluded surface, detected by sourceAnswerId prefix)', async () => {
    await notifyNicheMatch(ANSWERER, QUESTION, AUTHOR, `joshing_game:game-9:${QUESTION}:${ANSWERER}`);

    expect(getRelationshipMock).not.toHaveBeenCalled();
    expect(writeActivityMock).not.toHaveBeenCalled();
  });

  it('still fires for the other organic surfaces (e.g. a daily-prefixed sourceAnswerId)', async () => {
    await notifyNicheMatch(ANSWERER, QUESTION, AUTHOR, `daily:key:${ANSWERER}`);

    expect(writeActivityMock).toHaveBeenCalledTimes(2);
  });
});

describe('notifyNicheMatch — asymmetric two-flag gate (both directions)', () => {
  it('only the answerer opted in: writes ONLY the author-side row (which exposes the answerer)', async () => {
    getNicheMatchDiscoverableMock.mockResolvedValue(new Set([ANSWERER]));

    await notifyNicheMatch(ANSWERER, QUESTION, AUTHOR);

    expect(writeActivityMock).toHaveBeenCalledTimes(1);
    expect(writeActivityMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: AUTHOR,
      type: 'niche_match_answered_your_question',
      actorUserId: ANSWERER,
    }));
  });

  it('only the author opted in: writes ONLY the answerer-side row (which exposes the author)', async () => {
    getNicheMatchDiscoverableMock.mockResolvedValue(new Set([AUTHOR]));

    await notifyNicheMatch(ANSWERER, QUESTION, AUTHOR);

    expect(writeActivityMock).toHaveBeenCalledTimes(1);
    expect(writeActivityMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: ANSWERER,
      type: 'niche_match_you_answered',
      actorUserId: AUTHOR,
    }));
  });

  it('neither opted in: writes nothing', async () => {
    getNicheMatchDiscoverableMock.mockResolvedValue(new Set<string>());

    await notifyNicheMatch(ANSWERER, QUESTION, AUTHOR);

    expect(writeActivityMock).not.toHaveBeenCalled();
  });
});
