import { PrismaClient } from '@prisma/client';

// Prevent creating multiple PrismaClient instances across hot reloads and
// serverless warm invocations.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const SERVERLESS_POOL_POLICY = {
  // These bounds intentionally cap each setting at conservative defaults to protect
  // serverless deployments from accidental over-allocation and timeout inflation.
  // Any missing, non-numeric, or out-of-range value is normalized to DEFAULT.
  CONNECTION_LIMIT: {
    MIN: 1,
    MAX: 3,
    DEFAULT: 1,
  },
  POOL_TIMEOUT: {
    MIN: 1,
    MAX: 20,
    DEFAULT: 20,
  },
  CONNECT_TIMEOUT: {
    MIN: 1,
    MAX: 10,
    DEFAULT: 10,
  },
} as const;

function normalizeBoundedInteger(
  value: string | null,
  min: number,
  max: number,
  fallback: number,
): string {
  // Only allow whole-number strings (no decimals, exponent notation, or mixed text).
  if (!value || !/^-?\d+$/.test(value.trim())) {
    return String(fallback);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return String(fallback);
  }

  return String(parsed);
}

export function withServerlessPoolLimits(
  url: string | undefined,
): string | undefined {
  if (!url) return url;

  try {
    const parsed = new URL(url);
    const pgbouncer = parsed.searchParams.get('pgbouncer');
    const connectionLimit = parsed.searchParams.get('connection_limit');
    const poolTimeout = parsed.searchParams.get('pool_timeout');
    const connectTimeout = parsed.searchParams.get('connect_timeout');

    // Prisma + serverless works best when using PgBouncer-style transaction pooling.
    // Enforce production-safe defaults even when env vars include unsafe values.
    if (pgbouncer !== 'true') {
      parsed.searchParams.set('pgbouncer', 'true');
    }

    parsed.searchParams.set(
      'connection_limit',
      normalizeBoundedInteger(
        connectionLimit,
        SERVERLESS_POOL_POLICY.CONNECTION_LIMIT.MIN,
        SERVERLESS_POOL_POLICY.CONNECTION_LIMIT.MAX,
        SERVERLESS_POOL_POLICY.CONNECTION_LIMIT.DEFAULT,
      ),
    );

    parsed.searchParams.set(
      'pool_timeout',
      normalizeBoundedInteger(
        poolTimeout,
        SERVERLESS_POOL_POLICY.POOL_TIMEOUT.MIN,
        SERVERLESS_POOL_POLICY.POOL_TIMEOUT.MAX,
        SERVERLESS_POOL_POLICY.POOL_TIMEOUT.DEFAULT,
      ),
    );

    parsed.searchParams.set(
      'connect_timeout',
      normalizeBoundedInteger(
        connectTimeout,
        SERVERLESS_POOL_POLICY.CONNECT_TIMEOUT.MIN,
        SERVERLESS_POOL_POLICY.CONNECT_TIMEOUT.MAX,
        SERVERLESS_POOL_POLICY.CONNECT_TIMEOUT.DEFAULT,
      ),
    );

    return parsed.toString();
  } catch {
    // If DATABASE_URL is not URL-parseable, let Prisma handle validation/errors.
    return url;
  }
}

const datasourceUrl =
  process.env.NODE_ENV === 'production'
    ? withServerlessPoolLimits(process.env.DATABASE_URL)
    : process.env.DATABASE_URL;

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = new PrismaClient({
    ...(datasourceUrl ? { datasourceUrl } : {}),
    log: ['error', 'warn'],
  });
}

export const prisma = globalForPrisma.prisma;
