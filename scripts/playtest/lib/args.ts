export type PlaytestArgs = {
  players: number;
  questions: number;
  correctnessRate: number;
  headed: boolean;
  baseUrl: string;
  clean: boolean;
  runId: string | null;
  keep: boolean;
  scenarioIds: string[];
};

function readFlag(args: string[], name: string): string | null {
  const prefix = `--${name}=`;
  const direct = args.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) {
    return args[idx + 1];
  }
  return null;
}

function readBoolFlag(args: string[], name: string, fallback: boolean): boolean {
  const raw = readFlag(args, name);
  if (raw === null) return args.includes(`--${name}`) ? true : fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return fallback;
}

function readIntFlag(args: string[], name: string, fallback: number): number {
  const raw = readFlag(args, name);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readFloatFlag(args: string[], name: string, fallback: number): number {
  const raw = readFlag(args, name);
  if (raw === null) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parsePlaytestArgs(argv: string[]): PlaytestArgs {
  const args = argv.slice(2);

  const single = readFlag(args, 'scenario');
  const multi = readFlag(args, 'scenarios');
  const scenarioIds: string[] = [];
  if (single) scenarioIds.push(single.trim());
  if (multi) {
    for (const id of multi.split(',')) {
      const trimmed = id.trim();
      if (trimmed) scenarioIds.push(trimmed);
    }
  }

  return {
    players: readIntFlag(args, 'players', 3),
    questions: readIntFlag(args, 'questions', 3),
    correctnessRate: readFloatFlag(args, 'correctness-rate', 0.7),
    headed: readBoolFlag(args, 'headed', true),
    baseUrl: readFlag(args, 'base-url') ?? process.env.PLAYTEST_BASE_URL ?? 'http://localhost:3000',
    clean: args.includes('--clean'),
    runId: readFlag(args, 'run-id'),
    keep: readBoolFlag(args, 'keep', true),
    scenarioIds,
  };
}
