import { notFound, redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import {
  loadFriendCoverage,
  type FriendCoverageDiagnosis,
  type FriendCoverageEventRow,
  type FriendCoverageFriendBlock,
} from '@/app/api/feed/friend-coverage/route';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<{ friend?: string; limit?: string }>;
};

function isFeedDebugEnabled() {
  return process.env.NODE_ENV !== 'production' || process.env.FEED_DEBUG_ENABLED === 'true';
}

const DIAGNOSIS_COLORS: Record<FriendCoverageDiagnosis, string> = {
  visible: '#0a7d2a',
  friendship_inactive: '#a07e00',
  eligibility_failed: '#a02500',
  friend_thumbs_down: '#7c00a0',
  domain_dismissed_by_viewer: '#7c00a0',
  no_feed_item_written: '#a02500',
  feed_item_state_hidden: '#7c00a0',
  source_result_wrong: '#a02500',
  rolled_off: '#7c00a0',
  question_now_private_or_deleted: '#a07e00',
};

function fmtTimestamp(value: string | null): string {
  if (!value) return '—';
  return value.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

function fmtBool(value: boolean): string {
  return value ? 'YES' : 'no';
}

function EventRow({ row }: { row: FriendCoverageEventRow }) {
  const color = DIAGNOSIS_COLORS[row.diagnosis] ?? '#000';
  return (
    <tr style={{ verticalAlign: 'top' }}>
      <td style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'nowrap' }}>
        {fmtTimestamp(row.answeredAt)}
      </td>
      <td style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: '11px' }}>
        {row.masterySourceType}
      </td>
      <td style={{ padding: '4px 8px', fontSize: '12px', maxWidth: '380px' }}>
        <div>{row.questionTextSnippet ?? <em>(question missing)</em>}</div>
        <div style={{ fontFamily: 'monospace', fontSize: '10px', color: '#666' }}>
          q={row.questionId ?? 'null'} domain={row.questionCanonicalSubcategory ?? row.questionBroadCategory ?? 'null'} visibility={row.questionVisibility ?? 'null'} source={row.questionSource ?? 'null'} deletedAt={row.questionDeletedAt ?? 'null'} creator={row.questionCreatorId ?? 'null'}
        </div>
      </td>
      <td style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'nowrap' }}>
        elig={fmtBool(row.eligibilityWouldPass)}<br />
        thumbsDown={fmtBool(row.friendThumbsDown)}<br />
        dismissed={fmtBool(row.viewerDomainDismissed)}
      </td>
      <td style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'nowrap' }}>
        {row.feedItem ? (
          <>
            id={row.feedItem.id.slice(0, 8)}…<br />
            state={row.feedItem.state}<br />
            sourceResult={row.feedItem.sourceResult ?? 'null'}<br />
            sourceEventAt={fmtTimestamp(row.feedItem.sourceEventAt)}<br />
            sourceAnswerId={row.feedItem.sourceAnswerId ?? 'null'}<br />
            isPinned={fmtBool(row.feedItem.isPinned)}
          </>
        ) : (
          <span style={{ color: '#a02500' }}>no row</span>
        )}
      </td>
      <td style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: '12px', fontWeight: 'bold', color, whiteSpace: 'nowrap' }}>
        {row.diagnosis}
      </td>
    </tr>
  );
}

function FriendBlock({ block }: { block: FriendCoverageFriendBlock }) {
  return (
    <details open style={{ marginBottom: '16px', border: '1px solid #ddd', padding: '8px' }}>
      <summary style={{ cursor: 'pointer', fontFamily: 'monospace', fontSize: '13px' }}>
        <strong>{block.friendDisplayName ?? '(no display name)'}</strong>
        {' · '}id={block.friendUserId}
        {' · '}phone={block.friendPhoneNumber ?? '—'}
        {' · '}friendship={block.friendshipStatus ?? '(none)'}
        {' · '}rows={block.recentCorrectAnswers.length}
      </summary>

      {block.note && <p style={{ color: '#666', fontSize: '12px', marginTop: '8px' }}>{block.note}</p>}

      {block.recentCorrectAnswers.length > 0 && (
        <table style={{ width: '100%', marginTop: '8px', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f4f4f4' }}>
              <th style={{ padding: '4px 8px', textAlign: 'left', fontSize: '11px' }}>answered_at</th>
              <th style={{ padding: '4px 8px', textAlign: 'left', fontSize: '11px' }}>source</th>
              <th style={{ padding: '4px 8px', textAlign: 'left', fontSize: '11px' }}>question</th>
              <th style={{ padding: '4px 8px', textAlign: 'left', fontSize: '11px' }}>gates</th>
              <th style={{ padding: '4px 8px', textAlign: 'left', fontSize: '11px' }}>feedItem</th>
              <th style={{ padding: '4px 8px', textAlign: 'left', fontSize: '11px' }}>diagnosis</th>
            </tr>
          </thead>
          <tbody>
            {block.recentCorrectAnswers.map((row) => (
              <EventRow key={row.masteryEventId} row={row} />
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}

export default async function FriendCoverageDebugPage({ searchParams }: PageProps) {
  if (!isFeedDebugEnabled()) notFound();

  const session = await getSession();
  if (!session) redirect('/login');

  const params = await searchParams;
  const friendQuery = params.friend?.trim() || null;
  const rawLimit = Number(params.limit ?? '25');
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 25, 1), 100);

  const data = await loadFriendCoverage(session.userId, friendQuery, limit);

  const diagnosisCounts = data.friends
    .flatMap((f) => f.recentCorrectAnswers)
    .reduce<Record<string, number>>((acc, row) => {
      acc[row.diagnosis] = (acc[row.diagnosis] ?? 0) + 1;
      return acc;
    }, {});

  return (
    <main style={{ padding: '16px', maxWidth: '1400px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontFamily: 'monospace', fontSize: '18px' }}>Feed friend-coverage diagnostic</h1>
      <p style={{ color: '#666', fontSize: '12px', marginTop: '4px' }}>
        For each friend, the most recent <code>limit</code> correct daily / catchup mastery events, and whether each one is visible in your feed (and if not, why). This is a diagnostic, not product UI.
      </p>

      <form method="get" style={{ marginTop: '12px', fontSize: '12px' }}>
        <label>
          friend name/phone/id:{' '}
          <input name="friend" defaultValue={friendQuery ?? ''} style={{ padding: '2px 6px', fontFamily: 'monospace' }} />
        </label>
        {' '}
        <label>
          limit:{' '}
          <input name="limit" defaultValue={String(limit)} style={{ padding: '2px 6px', width: '60px', fontFamily: 'monospace' }} />
        </label>
        {' '}
        <button type="submit" style={{ padding: '3px 10px' }}>Run</button>
      </form>

      <section style={{ marginTop: '16px', padding: '8px 12px', background: '#fafafa', border: '1px solid #eee', fontFamily: 'monospace', fontSize: '12px' }}>
        <div>viewer={data.viewerUserId}</div>
        <div>friendQuery={data.friendQuery ?? '(all)'} limit={data.limit}</div>
        <div>
          friendships={data.summary.totalFriendshipsForViewer}
          {' · '}active={data.summary.activeFriendCount}
          {' · '}viewerActiveFeedItems={data.summary.viewerActiveFeedItemCount}/{data.summary.rolloffCap}
          {data.summary.viewerActiveFeedItemCount >= data.summary.rolloffCap && (
            <strong style={{ color: '#a02500' }}>{' '}— rolloff is in play</strong>
          )}
        </div>
        <div style={{ marginTop: '6px' }}>
          diagnosis counts:{' '}
          {Object.keys(diagnosisCounts).length === 0
            ? '(none)'
            : Object.entries(diagnosisCounts).map(([k, v]) => (
              <span key={k} style={{ marginRight: '12px', color: DIAGNOSIS_COLORS[k as FriendCoverageDiagnosis] ?? '#000' }}>
                {k}={v}
              </span>
            ))}
        </div>
      </section>

      <section style={{ marginTop: '16px' }}>
        {data.friends.length === 0 ? (
          <p style={{ color: '#666', fontSize: '13px' }}>No friends matched.</p>
        ) : (
          data.friends.map((block) => <FriendBlock key={block.friendUserId} block={block} />)
        )}
      </section>
    </main>
  );
}
