// PrismaClient removed - TODO R2: rewire to Drizzle db client
type DbClient = unknown;
export type GameWinnerMember = {
  user_id: string;
  display_name: string | null;
  phone_number: string | null;
  sms_opt_in: string;
};

export type GameWinnerResult = {
  winner: { display_name: string; user_id: string } | null;
  winnerUserId: string | null;
  isTie: boolean;
  allMembers: GameWinnerMember[];
  ceremony_mode: 'solo' | 'duo' | 'group';
  host_display_name: string | null;
};

/**
 * Compute the winner of a completed game and return member info for SMS dispatch.
 * Used by both the today/ route and the cron job when a game completes.
 */
export async function computeGameWinner(
  prisma: DbClient,
  gameId: string,
  groupId: string
): Promise<GameWinnerResult> {
  void prisma;
  void gameId;
  void groupId;
  // TODO v11.0: group member lookup needs new data source
  // TODO v11.0: group lookup needs new data source
  // TODO v11.0: answer.game_id winner scoping - needs new data source
  return {
    winner: null,
    winnerUserId: null,
    isTie: false,
    allMembers: [],
    ceremony_mode: 'solo',
    host_display_name: null,
  };
}
