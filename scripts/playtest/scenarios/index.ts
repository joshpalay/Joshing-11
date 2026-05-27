import { acceptInvitationScenario } from './accept-invitation';
import { authorQuestionScenario } from './author-question';
import { dailyQueueScenario } from './daily-queue';
import { playGameScenario } from './play-game';
import { sendInvitationScenario } from './send-invitation';
import type { Scenario } from '../lib/scenario-context';

// Order matters: scenarios run sequentially. Put the cheaper / faster
// scenarios first so a CI failure surfaces quickly. Each scenario seeds
// its own users (different phone ranges) so they're independent.
export const allScenarios: Scenario[] = [
  sendInvitationScenario,
  acceptInvitationScenario,
  authorQuestionScenario,
  dailyQueueScenario,
  playGameScenario,
];
