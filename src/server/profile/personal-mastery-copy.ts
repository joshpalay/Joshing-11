export const B5_PERSONAL_MASTERY_COPY = {
  /** Tier progress row (single mastery bar). */
  tierBar: {
    masterPeak: 'Mastery',
    toNext: (points: number, nextLabel: string) => `${points} pts to ${nextLabel}`,
  },
  /** Secondary / expandable only — not for primary card surfaces. */
  portraitBars: {
    createdPts: (display: string) => `${display} pts created`,
    answeredPts: (display: string) => `${display} pts answered`,
  },
  /** Per-card overlap — friend view (B10 + D2). */
  overlapLabels: {
    knowTerritoryToo: 'you know this territory too',
    stillFindingFooting: 'still finding your footing here',
    overlapTopPeer: (peerFirstName: string) => `You overlap most with ${peerFirstName} here`,
  },
  axisLabels: {
    full: {
      declared: 'declared',
      proven: 'proven',
    },
    compact: {
      declared: 'declared',
      proven: 'proven',
    },
  },
  friendSubtitle: {
    sharedGroundTerritories: (count: number) => `Shared ground in ${count} ${count === 1 ? 'territory' : 'territories'}.`,
    noSharedGround: 'Their world, not yet yours.',
  },
  emptyState: {
    own: {
      message: 'Your portrait is empty. It builds from what you write and what you prove — every question you ask, every answer you get right.',
      cta: 'Go to your active games',
    },
    friend: {
      message: (firstName: string) => `${firstName}'s portrait is still early.`,
    },
  },
  sparseNudge: 'Your portrait is early. It grows with every question you write and every answer you get right.',
  /** Own view only (D3 / B6). */
  ownPortraitFootnote: 'Proven territory includes any catch-up answers at half weight.',
  masteryHowItWorks: {
    trigger: 'How mastery works →',
    intro:
      'Mastery moves when you prove knowledge in live play, when you catch up on missed questions, and when you author questions others answer. Weights differ:',
    live: 'Live session — full weight toward mastery and portrait.',
    catchup: 'Catch-up — lighter weight toward mastery and half weight on your answered portrait bar.',
    authored: 'Questions you write — credit when others answer them correctly.',
  },
  multitudesFallback: {
    singleSparse: (category: string) => `Early days — but already: ${category}.`,
    dualSparse: (firstCategory: string, secondCategory: string) => `Starting to take shape: ${firstCategory} and ${secondCategory}.`,
    listJoiner: ' · ',
  },
  card: {
    /** Standing lines — category name appears in the title; these complete the sentence (B4c / B10). */
    tierLines: {
      familiar: (category: string) => `${category}. You're finding your ground.`,
      solid: (category: string) => `${category}. You move through this naturally now.`,
      mastery: (category: string) => `${category}. This one's yours.`,
    },
    links: {
      ownQuestionsInCategory: 'See your questions in this category →',
      showFewerInBroadCategory: (broadCategory: string) => `Show fewer in ${broadCategory} ←`,
      moreInBroadCategory: (remainingCount: number, broadCategory: string) => `${remainingCount} more in ${broadCategory} →`,
    },
    sourceBreakdownEmpty: 'Nothing logged in your latest round for this territory yet.',
  },
  futureHooks: {
    explore: 'Explore this territory →',
    askOthers: 'Ask others about this →',
  },
  comingSoonModal: {
    title: 'Coming soon',
    body: "You'll be able to go deeper here — explore what friends know, or invite new questions — when this ships.",
    cta: 'Got it',
  },
  tertiary: {
    gainedThisRound: (n: number) => `+${n} this round`,
    gainedThisSeason: (n: string) => `+${n} this season`,
  },
  unexplored: {
    heading: 'YOUR WORLD, NOT THEIRS YET',
    subtitle: (firstName: string) => `Territories you've explored that ${firstName} hasn't entered yet.`,
    links: {
      showFewer: 'Show fewer unexplored territories ←',
      showMore: (remainingCount: number) => `And ${remainingCount} more you've explored that they haven't →`,
    },
  },
} as const;
