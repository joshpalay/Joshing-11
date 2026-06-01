export type Domain = {
  name: string;
  tier: 'establishing' | 'familiar' | 'solid' | 'mastery';
  progressWithinTier: number;
  masteryPoints: number;
};

export const mockKnowledgeDomains: Domain[] = [
  { name: 'Story Architecture', tier: 'mastery', progressWithinTier: 0.82, masteryPoints: 4680 },
  { name: 'Relational Psychology', tier: 'mastery', progressWithinTier: 0.36, masteryPoints: 4010 },
  { name: 'Diaspora History', tier: 'solid', progressWithinTier: 0.78, masteryPoints: 3310 },
  { name: 'Ritual and Meaning', tier: 'solid', progressWithinTier: 0.51, masteryPoints: 2875 },
  { name: 'Civic Design', tier: 'solid', progressWithinTier: 0.16, masteryPoints: 2440 },
  { name: 'Narrative Ethics', tier: 'familiar', progressWithinTier: 0.91, masteryPoints: 1985 },
  { name: 'Diasporic Literature', tier: 'familiar', progressWithinTier: 0.44, masteryPoints: 1650 },
  { name: 'Political Theology', tier: 'familiar', progressWithinTier: 0.12, masteryPoints: 1430 },
  { name: 'Food Systems', tier: 'establishing', progressWithinTier: 0.74, masteryPoints: 970 },
  {
    name: 'Oceanic Trade Routes',
    tier: 'establishing',
    progressWithinTier: 0.39,
    masteryPoints: 640,
  },
  {
    name: 'Urban Biodiversity',
    tier: 'establishing',
    progressWithinTier: 0.19,
    masteryPoints: 510,
  },
];
