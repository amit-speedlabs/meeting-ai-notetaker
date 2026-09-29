-- Audio segments stored in the database (AUDIO_STORE=postgres), for hosts without a persistent disk.
create table if not exists audio_blobs (
  key text primary key,
  data bytea not null,
  created_at timestamptz not null default now()
);
