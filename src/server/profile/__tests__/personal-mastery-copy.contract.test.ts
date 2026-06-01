import { describe, expect, it } from 'vitest';
import { B5_PERSONAL_MASTERY_COPY } from '@/server/profile/personal-mastery-copy';

describe('B5 personal mastery copy contract', () => {
  it('matches approved B5 overlap and axis labels exactly', () => {
    expect(B5_PERSONAL_MASTERY_COPY).toMatchInlineSnapshot(`
      {
        "axisLabels": {
          "compact": {
            "declared": "declared",
            "proven": "proven",
          },
          "full": {
            "declared": "declared",
            "proven": "proven",
          },
        },
        "card": {
          "links": {
            "moreInBroadCategory": [Function],
            "ownQuestionsInCategory": "See your questions in this category →",
            "showFewerInBroadCategory": [Function],
          },
          "sourceBreakdownEmpty": "Nothing logged in your latest round for this territory yet.",
          "tierLines": {
            "familiar": [Function],
            "mastery": [Function],
            "solid": [Function],
          },
        },
        "comingSoonModal": {
          "body": "You'll be able to go deeper here — explore what friends know, or invite new questions — when this ships.",
          "cta": "Got it",
          "title": "Coming soon",
        },
        "emptyState": {
          "friend": {
            "message": [Function],
          },
          "own": {
            "cta": "Go to your active games",
            "message": "Your portrait is empty. It builds from what you write and what you prove — every question you ask, every answer you get right.",
          },
        },
        "friendSubtitle": {
          "noSharedGround": "Their world, not yet yours.",
          "sharedGroundTerritories": [Function],
        },
        "futureHooks": {
          "askOthers": "Ask others about this →",
          "explore": "Explore this territory →",
        },
        "masteryHowItWorks": {
          "authored": "Questions you write — credit when others answer them correctly.",
          "catchup": "Catch-up — lighter weight toward mastery and half weight on your answered portrait bar.",
          "intro": "Mastery moves when you prove knowledge in live play, when you catch up on missed questions, and when you author questions others answer. Weights differ:",
          "live": "Live session — full weight toward mastery and portrait.",
          "trigger": "How mastery works →",
        },
        "multitudesFallback": {
          "dualSparse": [Function],
          "listJoiner": " · ",
          "singleSparse": [Function],
        },
        "overlapLabels": {
          "knowTerritoryToo": "you know this territory too",
          "overlapTopPeer": [Function],
          "stillFindingFooting": "still finding your footing here",
        },
        "ownPortraitFootnote": "Proven territory includes any catch-up answers at half weight.",
        "portraitBars": {
          "answeredPts": [Function],
          "createdPts": [Function],
        },
        "sparseNudge": "Your portrait is early. It grows with every question you write and every answer you get right.",
        "tertiary": {
          "gainedThisRound": [Function],
          "gainedThisSeason": [Function],
        },
        "tierBar": {
          "masterPeak": "Mastery",
          "toNext": [Function],
        },
        "unexplored": {
          "heading": "YOUR WORLD, NOT THEIRS YET",
          "links": {
            "showFewer": "Show fewer unexplored territories ←",
            "showMore": [Function],
          },
          "subtitle": [Function],
        },
      }
    `);
  });

  it('locks dynamic copy renderers and exact tier lines', () => {
    expect(B5_PERSONAL_MASTERY_COPY.friendSubtitle.sharedGroundTerritories(3)).toBe(
      'Shared ground in 3 territories.',
    );
    expect(B5_PERSONAL_MASTERY_COPY.emptyState.friend.message('Maya')).toBe(
      "Maya's portrait is still early.",
    );
    expect(B5_PERSONAL_MASTERY_COPY.unexplored.subtitle('Maya')).toBe(
      "Territories you've explored that Maya hasn't entered yet.",
    );
    expect(B5_PERSONAL_MASTERY_COPY.multitudesFallback.singleSparse('Late Tchaikovsky')).toBe(
      'Early days — but already: Late Tchaikovsky.',
    );
    expect(
      B5_PERSONAL_MASTERY_COPY.multitudesFallback.dualSparse(
        'Late Tchaikovsky',
        'Counterpoint species writing',
      ),
    ).toBe('Starting to take shape: Late Tchaikovsky and Counterpoint species writing.');
    expect(B5_PERSONAL_MASTERY_COPY.card.tierLines.familiar('Late Bach')).toBe(
      "Late Bach. You're finding your ground.",
    );
    expect(B5_PERSONAL_MASTERY_COPY.card.tierLines.solid('Late Bach')).toBe(
      'Late Bach. You move through this naturally now.',
    );
    expect(B5_PERSONAL_MASTERY_COPY.card.tierLines.mastery('Late Bach')).toBe(
      "Late Bach. This one's yours.",
    );
    expect(B5_PERSONAL_MASTERY_COPY.tierBar.toNext(4, 'Familiar')).toBe('4 pts to Familiar');
    expect(B5_PERSONAL_MASTERY_COPY.tierBar.masterPeak).toBe('Mastery');
    expect(B5_PERSONAL_MASTERY_COPY.portraitBars.createdPts('3')).toBe('3 pts created');
    expect(B5_PERSONAL_MASTERY_COPY.portraitBars.answeredPts('2.5')).toBe('2.5 pts answered');
    expect(B5_PERSONAL_MASTERY_COPY.overlapLabels.overlapTopPeer('Sam')).toBe(
      'You overlap most with Sam here',
    );
  });
});
