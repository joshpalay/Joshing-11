// TODO R2: replace Prisma transaction/client shapes with Drizzle equivalents.

type DbClient = unknown;

type SnapshotSeasonMasteryInput = {
  groupId: string;
};

/**
 * Capture baseline mastery at season start for all active group members.
 *
 * Idempotency:
 * - Uses "IS DISTINCT FROM" so rows already aligned with current total_points
 *   are skipped.
 * - Re-running in the same game-creation transaction is a no-op.
 */
export async function snapshotSeasonMasteryStart(
  db: DbClient,
  input: SnapshotSeasonMasteryInput
): Promise<void> {
  void db;
  void input;
  // TODO v11.0: "GroupMember" raw SQL table - needs new data source
}
