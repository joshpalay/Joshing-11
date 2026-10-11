import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  row: null as null | Record<string, unknown>,
  totals: { spent: '0', reserved: '0' },
  query: vi.fn(), release: vi.fn(),
}));
vi.mock('pg', () => ({ default: { Pool: class {
  connect() { return Promise.resolve({ query: db.query, release: db.release }); }
} } }));
import { reserveCall, settleCall } from '../budget';

beforeEach(() => {
  db.row = { id: 'test', manifest_sha: 'frozen', status: 'active', spent_usd: '0', reserved_usd: '0', calls: {} };
  db.totals = { spent: '0', reserved: '0' };
  db.query.mockReset(); db.release.mockReset();
  db.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith('SELECT *')) return { rows: [db.row] };
    if (sql.startsWith('SELECT COALESCE')) return { rows: [db.totals] };
    return { rows: [] };
  });
});
const request = { runId: 'test', manifestSha: 'frozen', key: 'writer:topic:baseline', reserveUsd: 0.35, runCap: 1.5 };

describe('Cassian reservation recovery', () => {
  it('returns a completed step without reserving or settling it again', async () => {
    db.row!.calls = { [request.key]: { status: 'done', reservedUsd: 0.35, actualUsd: 0.01 } };
    await expect(reserveCall(request)).resolves.toBe('already_done');
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
  });
  it.each(['reserved', 'uncertain'])('blocks an unresolved %s call without adding another reservation', async status => {
    db.row!.calls = { [request.key]: { status, reservedUsd: 0.35 } };
    await expect(reserveCall(request)).rejects.toThrow('unresolved');
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
    expect(db.query).toHaveBeenCalledWith('ROLLBACK');
  });
  it('enforces the selected block cap even with lifetime budget available', async () => {
    db.row!.spent_usd = '1.2'; db.totals.spent = '3.9';
    await expect(reserveCall(request)).rejects.toThrow('budget cap');
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
  });
  it('rejects a changed frozen manifest before dispatch', async () => {
    await expect(reserveCall({ ...request, manifestSha: 'changed' })).rejects.toThrow('manifest changed');
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
  });
  it('retains the ceiling and halts the run when a provider charge is unknown', async () => {
    db.row!.calls = { [request.key]: { status: 'reserved', reservedUsd: 0.35 } };
    await settleCall({ runId: 'test', key: request.key, actualUsd: null, reason: 'provider timeout' });
    const [, args] = db.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE'))!;
    expect(JSON.parse(args[1])[request.key]).toMatchObject({ status: 'uncertain', reservedUsd: 0.35 });
    expect(args.slice(2)).toEqual([0, 0, true]);
  });
  it('halts further dispatch if actual cost exceeds its reserved ceiling', async () => {
    db.row!.calls = { [request.key]: { status: 'reserved', reservedUsd: 0.35 } };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await settleCall({ runId: 'test', key: request.key, actualUsd: 0.4 });
    const [, args] = db.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE'))!;
    expect(args.slice(2)).toEqual([0.4, 0.35, true]);
    error.mockRestore();
  });
});
