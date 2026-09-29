import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5432/notetaker' });
  await c.connect();
  await c.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const dir = path.join(__dirname, '..', 'db', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const done = await c.query('select 1 from schema_migrations where name = $1', [f]);
    if (done.rowCount) continue;
    console.log('applying', f);
    await c.query('begin');
    await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    await c.query('insert into schema_migrations (name) values ($1)', [f]);
    await c.query('commit');
  }
  console.log('migrations up to date');
  await c.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
