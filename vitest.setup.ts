// Vitest global setup. Runs before any test module is imported.
//
// Several modules under src/server/db read process.env at import time and throw
// when DATABASE_URL is missing (src/server/db/index.ts). Many tests import the
// real db module — either deliberately (to mirror the production import graph,
// e.g. a page that should redirect before querying) or via a vi.mock factory
// that calls importOriginal(). Without a value here, those modules throw at
// import and the whole suite fails to load.
//
// Use an unroutable localhost placeholder: the pg Pool is constructed lazily and
// never connects unless a query runs, so this satisfies the import-time guard
// while making any *accidental* real query fail fast instead of reaching a live
// database.
process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/joshing_test';
process.env.DIRECT_URL ??= process.env.DATABASE_URL;
