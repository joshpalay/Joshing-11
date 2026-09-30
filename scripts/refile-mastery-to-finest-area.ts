/**
 * One-time repair for the "Hamlet shows as not started" bug (2026-09-29).
 *
 * The live answer path credited points to the SERVED domain — the player's
 * GeneratedQuestion copy keeps the slot domain it was generated under — while
 * the canonical Question was later filed under a finer child node. So 13 Hamlet
 * answers landed in "Shakespearean Tragedy" and the map (which reads per-node
 * PLAYER_MASTERY and rolls children up into parents) drew Hamlet as a ghost.
 * writeMasteryEvent now credits the finer area going forward
 * (resolveCreditDomain); this script re-files the history the same way.
 *
 * Scope — ONLY events whose canonical Question's current domain is a strict
 * graph DESCENDANT of the event's stored domain (KnowledgeEdge, transitive).
 * Sideways re-files and same-area rows are untouched. Per affected event:
 *   - MASTERY_EVENTS.canonical_subcategory → the finer area.
 *   - PLAYER_MASTERY: the parent row gives up those points, the child row gains
 *     them (created if missing, parked OUT of rotation — serving stays flat).
 *     The map rolls the child back up, so the parent's map total is unchanged.
 *   - A tier is never lowered: the parent's own points drop, but it keeps the
 *     tier it already earned (mastery is never revoked).
 * A player whose parent row doesn't exist (a bonus answer never adopted) gets
 * the event relabel only — nothing is added to their map.
 *
 * Read-only by default. Run from repo root (Node 24):
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/refile-mastery-to-finest-area.ts
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/refile-mastery-to-finest-area.ts --apply
 *
 * Idempotent: after --apply the moved events carry the finer label, so a re-run
 * finds nothing.
 */
import pg from 'pg';

import { domainKey } from '../src/lib/knowledge/domain-key';
import { substantiveAncestors, type GraphEdge } from '../src/server/knowledge/graph';
import { effectiveTier } from '../src/server/mastery/tiers';
import type { MasteryTier } from '../src/types/db';

const DB_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('No DIRECT_URL/DATABASE_URL in env');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');

const TIER_RANK: Record<MasteryTier, number> = { establishing: 0, familiar: 1, solid: 2, mastery: 3 };
const maxTier = (a: MasteryTier, b: MasteryTier) => (TIER_RANK[a] >= TIER_RANK[b] ? a : b);

type EventRow = {
  id: string;
  user_id: string;
  served: string;
  finer: string;
  awarded_points: number;
};

type MasteryRow = {
  canonical_subcategory: string;
  broad_category: string | null;
  total_points: number;
  tier: MasteryTier;
};

type Move = {
  userId: string;
  parentLabel: string; // the user's existing PLAYER_MASTERY label for the served area
  childLabel: string; // the user's existing label for the finer area, or the question's label
  eventIds: string[];
  points: number;
};

async function main() {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const { rows: edgeRows } = await client.query<{ child_domain_key: string; parent_domain_key: string }>(
      'SELECT child_domain_key, parent_domain_key FROM "KnowledgeEdge"',
    );
    const edges: GraphEdge[] = edgeRows.map((e) => ({
      childDomainKey: e.child_domain_key,
      parentDomainKey: e.parent_domain_key,
    }));
    const ancestorsMemo = new Map<string, Set<string>>();
    const ancestorsOf = (key: string) => {
      let set = ancestorsMemo.get(key);
      if (!set) {
        set = substantiveAncestors(key, edges);
        ancestorsMemo.set(key, set);
      }
      return set;
    };

    // Answer events only (author/curator credit carry their authored domain).
    const { rows: candidates } = await client.query<EventRow>(`
      SELECT me.id, me.user_id, me.canonical_subcategory AS served,
             q.canonical_subcategory AS finer, me.awarded_points
      FROM "MASTERY_EVENTS" me
      JOIN "Question" q ON q.id = me.question_id
      WHERE me.source_type IN ('live_correct', 'catchup_correct')
        AND q.canonical_subcategory IS NOT NULL
        AND lower(q.canonical_subcategory) <> lower(me.canonical_subcategory)
    `);

    const events = candidates.filter((e) => {
      const childKey = domainKey(e.finer);
      const servedKey = domainKey(e.served);
      return childKey !== servedKey && ancestorsOf(childKey).has(servedKey);
    });

    const userIds = [...new Set(events.map((e) => e.user_id))];
    const masteryByUser = new Map<string, MasteryRow[]>();
    const nameByUser = new Map<string, string>();
    if (userIds.length > 0) {
      const { rows: pm } = await client.query<MasteryRow & { user_id: string }>(
        `SELECT user_id, canonical_subcategory, broad_category, total_points, tier
         FROM "PLAYER_MASTERY" WHERE user_id = ANY($1)`,
        [userIds],
      );
      for (const row of pm) {
        const list = masteryByUser.get(row.user_id) ?? [];
        list.push(row);
        masteryByUser.set(row.user_id, list);
      }
      const { rows: users } = await client.query<{ id: string; display_name: string | null }>(
        'SELECT id, display_name FROM "User" WHERE id = ANY($1)',
        [userIds],
      );
      for (const u of users) nameByUser.set(u.id, u.display_name ?? u.id.slice(0, 8));
    }

    const findRow = (userId: string, label: string) =>
      (masteryByUser.get(userId) ?? []).find((r) => domainKey(r.canonical_subcategory) === domainKey(label));

    // Group events into (user, parent row, child area) moves.
    const moves = new Map<string, Move>();
    const relabelOnly: EventRow[] = [];
    for (const e of events) {
      const parentRow = findRow(e.user_id, e.served);
      const childLabel = findRow(e.user_id, e.finer)?.canonical_subcategory ?? e.finer;
      if (!parentRow) {
        relabelOnly.push({ ...e, finer: childLabel });
        continue;
      }
      const key = `${e.user_id}\u0000${domainKey(parentRow.canonical_subcategory)}\u0000${domainKey(childLabel)}`;
      const move = moves.get(key) ?? {
        userId: e.user_id,
        parentLabel: parentRow.canonical_subcategory,
        childLabel,
        eventIds: [],
        points: 0,
      };
      move.eventIds.push(e.id);
      move.points += Number(e.awarded_points ?? 0);
      moves.set(key, move);
    }

    // Author credit per (user, area) — the Mastery tier gate needs it.
    const authorCredit = async (userId: string, label: string) => {
      const { rows } = await client.query<{ pts: number; qs: number }>(
        `SELECT coalesce(sum(awarded_points), 0)::float AS pts, count(DISTINCT question_id)::int AS qs
         FROM "MASTERY_EVENTS"
         WHERE user_id = $1 AND source_type = 'author_credit' AND canonical_subcategory = $2`,
        [userId, label],
      );
      return { pts: Number(rows[0]?.pts ?? 0), qs: Number(rows[0]?.qs ?? 0) };
    };

    // Plan the PLAYER_MASTERY changes. Several moves can hit one parent row (two
    // children), or one child row, so accumulate per row before computing tiers.
    const parentDelta = new Map<string, { userId: string; label: string; delta: number }>();
    const childDelta = new Map<string, { userId: string; label: string; delta: number; broad: string | null }>();
    for (const m of moves.values()) {
      const pKey = `${m.userId}\u0000${m.parentLabel}`;
      const p = parentDelta.get(pKey) ?? { userId: m.userId, label: m.parentLabel, delta: 0 };
      p.delta -= m.points;
      parentDelta.set(pKey, p);
      const cKey = `${m.userId}\u0000${m.childLabel}`;
      const parentBroad = findRow(m.userId, m.parentLabel)?.broad_category ?? null;
      const c = childDelta.get(cKey) ?? { userId: m.userId, label: m.childLabel, delta: 0, broad: parentBroad };
      c.delta += m.points;
      childDelta.set(cKey, c);
    }

    type Plan = {
      userId: string;
      label: string;
      role: 'parent' | 'child';
      before: number;
      after: number;
      tierBefore: MasteryTier | null;
      tierAfter: MasteryTier;
      created: boolean;
      broad: string | null;
    };
    const plans: Plan[] = [];
    for (const p of parentDelta.values()) {
      const row = findRow(p.userId, p.label)!;
      const after = Math.max(0, Number(row.total_points) + p.delta);
      const ac = await authorCredit(p.userId, p.label);
      plans.push({
        userId: p.userId,
        label: p.label,
        role: 'parent',
        before: Number(row.total_points),
        after,
        tierBefore: row.tier,
        tierAfter: maxTier(row.tier, effectiveTier(after, ac.pts, ac.qs)),
        created: false,
        broad: row.broad_category,
      });
    }
    for (const c of childDelta.values()) {
      const row = findRow(c.userId, c.label);
      const before = Number(row?.total_points ?? 0);
      const after = before + c.delta;
      const ac = await authorCredit(c.userId, c.label);
      const computed = effectiveTier(after, ac.pts, ac.qs);
      plans.push({
        userId: c.userId,
        label: c.label,
        role: 'child',
        before,
        after,
        tierBefore: row?.tier ?? null,
        tierAfter: row ? maxTier(row.tier, computed) : computed,
        created: !row,
        broad: row?.broad_category ?? c.broad,
      });
    }

    // ─── Report ───────────────────────────────────────────────────────────────
    const movedEvents = [...moves.values()].reduce((n, m) => n + m.eventIds.length, 0);
    const movedPoints = [...moves.values()].reduce((n, m) => n + m.points, 0);
    console.log(`\n${APPLY ? 'APPLY' : 'DRY RUN'} — re-file answers to the finest area`);
    console.log(`  candidate events (question filed under a child of the credited area): ${events.length}`);
    console.log(`  moves with points: ${movedEvents} events, ${movedPoints} pts, ${userIds.length} players`);
    console.log(`  relabel-only (player never adopted the parent area): ${relabelOnly.length}\n`);

    for (const userId of userIds) {
      const userMoves = [...moves.values()].filter((m) => m.userId === userId);
      const userPlans = plans.filter((p) => p.userId === userId);
      if (userMoves.length === 0 && !relabelOnly.some((e) => e.user_id === userId)) continue;
      console.log(`■ ${nameByUser.get(userId)}`);
      for (const m of userMoves) {
        console.log(`    ${m.eventIds.length} answers, ${m.points} pts: "${m.parentLabel}" → "${m.childLabel}"`);
      }
      for (const p of userPlans) {
        const tier = p.tierBefore === p.tierAfter ? p.tierAfter : `${p.tierBefore ?? '—'} → ${p.tierAfter}`;
        const note = p.created ? ' (NEW, out of rotation)' : '';
        console.log(`      ${p.role.padEnd(6)} ${p.label}: own ${p.before} → ${p.after} pts, tier ${tier}${note}`);
      }
      const relabels = relabelOnly.filter((e) => e.user_id === userId);
      if (relabels.length) console.log(`    ${relabels.length} relabel-only events`);
    }
    console.log(
      '\n  Map totals are unchanged: each parent\'s own points drop by exactly what its child gains, and the map adds the child back up.',
    );

    if (!APPLY) {
      console.log('\nDry run only — nothing written. Re-run with --apply to write.\n');
      return;
    }

    // ─── Apply (one transaction) ──────────────────────────────────────────────
    await client.query('BEGIN');
    try {
      for (const m of moves.values()) {
        await client.query('UPDATE "MASTERY_EVENTS" SET canonical_subcategory = $1 WHERE id = ANY($2)', [
          m.childLabel,
          m.eventIds,
        ]);
      }
      for (const e of relabelOnly) {
        await client.query('UPDATE "MASTERY_EVENTS" SET canonical_subcategory = $1 WHERE id = $2', [e.finer, e.id]);
      }
      for (const p of plans) {
        if (p.role === 'parent' || !p.created) {
          await client.query(
            `UPDATE "PLAYER_MASTERY" SET total_points = $3, tier = $4, updated_at = now()
             WHERE user_id = $1 AND canonical_subcategory = $2`,
            [p.userId, p.label, p.after, p.tierAfter],
          );
        } else {
          await client.query(
            `INSERT INTO "PLAYER_MASTERY"
               (user_id, canonical_subcategory, broad_category, total_points, tier, tier_reached_at, rotation_eligible)
             VALUES ($1, $2, $3, $4, $5::"MasteryTier",
                     CASE WHEN $5::"MasteryTier" <> 'establishing' THEN now() END, false)`,
            [p.userId, p.label, p.broad, p.after, p.tierAfter],
          );
        }
      }
      await client.query('COMMIT');
      console.log('\nApplied.\n');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
