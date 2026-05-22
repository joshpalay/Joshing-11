import { redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import {
  CATEGORY_VALUES,
  DIFFICULTY_VALUES,
  MAX_LIMIT,
  SOURCE_TYPE_VALUES,
  loadPointsDiagnostic,
  resolveUserByQuery,
  summarize,
  type Category,
  type DifficultyEstimate,
  type MasterySourceType,
  type UserMatch,
} from '@/server/db/queries/points-diagnostic';

import { PointsDiagnosticTable } from './PointsDiagnosticTable';

export const dynamic = 'force-dynamic';

type SearchParams = {
  user?: string;
  category?: string;
  difficulty?: string;
  sourceType?: string;
  from?: string;
  to?: string;
  limit?: string;
};

type PageProps = {
  searchParams: Promise<SearchParams>;
};

function asCategory(value: string | undefined): Category | undefined {
  return value && (CATEGORY_VALUES as readonly string[]).includes(value) ? (value as Category) : undefined;
}

function asDifficulty(value: string | undefined): DifficultyEstimate | undefined {
  return value && (DIFFICULTY_VALUES as readonly string[]).includes(value)
    ? (value as DifficultyEstimate)
    : undefined;
}

function asSourceType(value: string | undefined): MasterySourceType | undefined {
  return value && (SOURCE_TYPE_VALUES as readonly string[]).includes(value)
    ? (value as MasterySourceType)
    : undefined;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_LIMIT);
}

function userLabel(user: UserMatch): string {
  return user.displayName || user.phoneNumber || user.id;
}

const SUMMARY_BOX: React.CSSProperties = {
  padding: '8px 12px',
  background: '#fafafa',
  border: '1px solid #eee',
  fontFamily: 'monospace',
  fontSize: '12px',
};

const INPUT_STYLE: React.CSSProperties = {
  padding: '2px 6px',
  fontFamily: 'monospace',
  fontSize: '12px',
};

const LABEL_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  flexDirection: 'column',
  fontSize: '11px',
  color: '#444',
  marginRight: '12px',
  marginBottom: '6px',
};

export default async function PointsDiagnosticPage({ searchParams }: PageProps) {
  const session = await getSession();
  if (!session) redirect('/login');

  const params = await searchParams;
  const userQuery = params.user?.trim() || null;
  const category = asCategory(params.category);
  const difficulty = asDifficulty(params.difficulty);
  const sourceType = asSourceType(params.sourceType);
  const from = parseDate(params.from);
  const to = parseDate(params.to);
  const limit = parseLimit(params.limit);

  const resolution = userQuery ? await resolveUserByQuery(userQuery) : { match: null, nearMatches: [] };
  const target = resolution.match;

  const rows = target
    ? await loadPointsDiagnostic(target.id, { category, difficulty, sourceType, from, to, limit })
    : [];
  const summary = summarize(rows);

  const csvHref = (() => {
    if (!target) return null;
    const usp = new URLSearchParams();
    usp.set('user', target.id);
    usp.set('format', 'csv');
    if (category) usp.set('category', category);
    if (difficulty) usp.set('difficulty', difficulty);
    if (sourceType) usp.set('sourceType', sourceType);
    if (params.from) usp.set('from', params.from);
    if (params.to) usp.set('to', params.to);
    if (limit) usp.set('limit', String(limit));
    return `/api/dev/points-diagnostic?${usp.toString()}`;
  })();

  const correctDenominator = summary.correctCount + summary.incorrectCount;
  const pctCorrect = correctDenominator > 0
    ? `${Math.round((summary.correctCount / correctDenominator) * 100)}%`
    : '—';

  return (
    <main style={{ padding: '16px', maxWidth: '1600px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontFamily: 'monospace', fontSize: '18px', marginBottom: '4px' }}>
        Points diagnostic
      </h1>
      <p style={{ color: '#666', fontSize: '12px', marginTop: '0' }}>
        Every <code>MASTERY_EVENTS</code> row for a given user — live answers, catchup, author credit, and meta
        events. Click column headers to sort. This is a diagnostic, not product UI.
      </p>

      <form method="get" style={{ marginTop: '12px', padding: '12px', border: '1px solid #ddd', background: '#fff' }}>
        <div style={{ marginBottom: '10px' }}>
          <label style={LABEL_STYLE}>
            <span>user (id / display name / phone / email)</span>
            <input
              name="user"
              defaultValue={userQuery ?? ''}
              style={{ ...INPUT_STYLE, width: '320px' }}
              placeholder="Jane Smith"
            />
          </label>
          <button type="submit" style={{ padding: '4px 12px', fontSize: '12px' }}>Look up</button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          <label style={LABEL_STYLE}>
            <span>category</span>
            <select name="category" defaultValue={category ?? ''} style={INPUT_STYLE}>
              <option value="">(any)</option>
              {CATEGORY_VALUES.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </label>

          <label style={LABEL_STYLE}>
            <span>difficulty</span>
            <select name="difficulty" defaultValue={difficulty ?? ''} style={INPUT_STYLE}>
              <option value="">(any)</option>
              {DIFFICULTY_VALUES.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </label>

          <label style={LABEL_STYLE}>
            <span>source type</span>
            <select name="sourceType" defaultValue={sourceType ?? ''} style={INPUT_STYLE}>
              <option value="">(any)</option>
              {SOURCE_TYPE_VALUES.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </label>

          <label style={LABEL_STYLE}>
            <span>from (ISO date)</span>
            <input
              name="from"
              defaultValue={params.from ?? ''}
              style={{ ...INPUT_STYLE, width: '200px' }}
              placeholder="2025-01-01T00:00:00Z"
            />
          </label>

          <label style={LABEL_STYLE}>
            <span>to (ISO date)</span>
            <input
              name="to"
              defaultValue={params.to ?? ''}
              style={{ ...INPUT_STYLE, width: '200px' }}
              placeholder="2026-01-01T00:00:00Z"
            />
          </label>

          <label style={LABEL_STYLE}>
            <span>limit (max {MAX_LIMIT})</span>
            <input
              name="limit"
              defaultValue={limit ? String(limit) : ''}
              style={{ ...INPUT_STYLE, width: '80px' }}
              placeholder="500"
            />
          </label>
        </div>
      </form>

      {!target && resolution.nearMatches.length > 0 && (
        <section style={{ marginTop: '16px', ...SUMMARY_BOX, background: '#fffbe6', borderColor: '#c8b900' }}>
          <strong>Multiple matches — pick one:</strong>
          <ul style={{ marginTop: '6px', listStyle: 'none', padding: 0 }}>
            {resolution.nearMatches.map((match) => (
              <li key={match.id} style={{ marginTop: '4px' }}>
                <a href={`/dev/points-diagnostic?user=${encodeURIComponent(match.id)}`}>
                  {userLabel(match)}
                </a>
                <span style={{ color: '#666' }}>
                  {' · '}id={match.id}
                  {' · '}phone={match.phoneNumber}
                  {match.email ? ` · email=${match.email}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!target && userQuery && resolution.nearMatches.length === 0 && (
        <section style={{ marginTop: '16px', ...SUMMARY_BOX, background: '#ffefef', borderColor: '#a02500', color: '#a02500' }}>
          No user matched <code>{userQuery}</code>. Try an exact id, partial display name, phone, or email.
        </section>
      )}

      {!target && !userQuery && (
        <section style={{ marginTop: '16px', ...SUMMARY_BOX }}>
          Enter a user id, display name, phone number, or email above to load their mastery events.
        </section>
      )}

      {target && (
        <>
          <section style={{ marginTop: '16px', ...SUMMARY_BOX }}>
            <div>
              <strong>{userLabel(target)}</strong>
              {' · '}id={target.id}
              {' · '}phone={target.phoneNumber}
              {target.email ? ` · email=${target.email}` : ''}
            </div>
            <div style={{ marginTop: '6px' }}>
              events={summary.eventCount}
              {' · '}awarded_points_total={summary.totalAwardedPoints}
              {' · '}correct={summary.correctCount}
              {' · '}incorrect={summary.incorrectCount}
              {' · '}%correct={pctCorrect}
              {' · '}unique_questions={summary.uniqueQuestions}
            </div>
            {csvHref && (
              <div style={{ marginTop: '8px' }}>
                <a
                  href={csvHref}
                  download
                  style={{
                    display: 'inline-block',
                    padding: '4px 10px',
                    border: '1px solid #444',
                    background: '#fff',
                    color: '#000',
                    textDecoration: 'none',
                    fontSize: '11px',
                  }}
                >
                  Download CSV ({summary.eventCount} rows)
                </a>
              </div>
            )}
          </section>

          <section style={{ marginTop: '16px' }}>
            <PointsDiagnosticTable rows={rows} />
          </section>
        </>
      )}
    </main>
  );
}
