import { Pool, PoolClient, QueryResultRow, types } from 'pg';

// Return DATE columns as 'YYYY-MM-DD' strings (no timezone shifting).
types.setTypeParser(1082, (v) => v);

const globalForPg = globalThis as unknown as { __pgPool?: Pool };

export const pool =
  globalForPg.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5432/notetaker',
    // Serverless hosts run many small instances; keep each one's pool small there.
    max: Number(process.env.PG_POOL_MAX) || (process.env.VERCEL ? 3 : 10),
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
if (!globalForPg.__pgPool) globalForPg.__pgPool = pool;

export async function q<T extends QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query<T>(text, params as any[]);
  return r.rows;
}

export async function one<T extends QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
