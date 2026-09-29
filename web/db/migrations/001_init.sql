-- Meeting AI Notetaker schema (PostgreSQL 14+ / Supabase compatible)
create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  password_hash text,
  google_sub text unique,
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists user_settings (
  user_id uuid primary key references users(id) on delete cascade,
  store_audio boolean not null default true,
  retention_days integer,               -- null = until manually deleted
  updated_at timestamptz not null default now()
);

create table if not exists meetings (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references users(id) on delete cascade,
  title text not null,
  meeting_type text not null default 'Other',
  mode text not null check (mode in ('meet','offline','upload')),
  status text not null default 'NOT_STARTED'
    check (status in ('NOT_STARTED','RECORDING','PAUSED','PROCESSING','COMPLETED','FAILED')),
  transcription_status text not null default 'CONNECTING'
    check (transcription_status in ('CONNECTING','TRANSCRIBING','PAUSED','COMPLETED','FAILED')),
  start_time timestamptz,
  end_time timestamptz,
  duration_seconds integer not null default 0,
  speaker_map jsonb not null default '{}'::jsonb,
  transcription_provider text,
  llm_provider text,
  store_audio boolean not null default true,
  is_demo boolean not null default false,
  share_token text unique,
  notes_cursor integer not null default 0,
  notes_updated_at timestamptz,
  last_activity_at timestamptz,
  error text,
  meet_code text,
  timezone text not null default 'UTC',
  external_event_id text,          -- reserved for calendar integration
  calendar_source text,            -- reserved for calendar integration
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meetings_owner_idx on meetings(created_by, created_at desc);

create table if not exists participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  name text not null,
  email text,
  organisation text
);
create index if not exists participants_meeting_idx on participants(meeting_id);

create table if not exists transcript_segments (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  seq integer not null,
  offset_ms integer not null,
  speaker text,
  text text not null,
  confidence real,
  chunk_seq integer,
  created_at timestamptz not null default now(),
  tsv tsvector generated always as (to_tsvector('english', coalesce(text,''))) stored,
  unique (meeting_id, seq)
);
create index if not exists transcript_tsv_idx on transcript_segments using gin(tsv);
create index if not exists transcript_meeting_idx on transcript_segments(meeting_id, seq);

create table if not exists audio_chunks (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  chunk_seq integer not null,
  start_ms integer not null,
  duration_ms integer not null,
  mime text not null,
  bytes integer not null,
  storage_key text,
  status text not null default 'received' check (status in ('received','transcribed','failed','skipped')),
  error text,
  created_at timestamptz not null default now(),
  unique (meeting_id, chunk_seq)
);

create table if not exists notes (
  meeting_id uuid primary key references meetings(id) on delete cascade,
  summary text not null default '',
  key_points jsonb not null default '[]',
  decisions jsonb not null default '[]',
  open_questions jsonb not null default '[]',
  risks jsonb not null default '[]',
  follow_ups jsonb not null default '[]',
  important_numbers jsonb not null default '[]',
  topics jsonb not null default '[]',
  next_steps jsonb not null default '[]',
  is_final boolean not null default false,
  provider text,
  updated_at timestamptz not null default now()
);

create table if not exists action_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  task text not null,
  owner text not null default 'Unassigned',
  deadline_date date,
  deadline_text text not null default 'Not specified',
  status text not null default 'pending' check (status in ('pending','in_progress','completed','cancelled')),
  source text not null default 'ai' check (source in ('ai','manual')),
  user_edited boolean not null default false,
  source_quote text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists action_items_meeting_idx on action_items(meeting_id);

create table if not exists action_comments (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references action_items(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  kind text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists activity_meeting_idx on activity_log(meeting_id, created_at desc);

create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now());
