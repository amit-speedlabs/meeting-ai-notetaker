# Setup, configuration and deployment

## 1. Environment variables (`web/.env.local`, or your host's secret store)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | — | PostgreSQL connection string |
| `DATABASE_SSL` | no | `false` | `true` for hosted Postgres that needs TLS (Supabase, RDS) |
| `APP_URL` | yes | `http://localhost:3000` | Public URL; used for OAuth redirect and share links |
| `AUTH_SECRET` | yes | — | Long random string; signs OAuth state |
| `TRANSCRIPTION_PROVIDER` | no | `mock` | `mock` (demo only), `groq`, `openai`, `deepgram` |
| `GROQ_API_KEY` | if groq | — | Groq key (free tier; transcription and/or notes) |
| `GROQ_TRANSCRIBE_MODEL` / `GROQ_LLM_MODEL` | no | `whisper-large-v3-turbo` / `openai/gpt-oss-120b` | Groq models |
| `OPENAI_BASE_URL` | no | `https://api.openai.com/v1` | Point the OpenAI adapters at another OpenAI-compatible API |
| `OPENAI_API_KEY` | if openai | — | OpenAI key (transcription and/or notes) |
| `OPENAI_TRANSCRIBE_MODEL` | no | `gpt-4o-mini-transcribe` | e.g. `whisper-1` (returns per-segment confidence) |
| `DEEPGRAM_API_KEY` | if deepgram | — | Deepgram key |
| `DEEPGRAM_MODEL` | no | `nova-3` | Deepgram model |
| `TRANSCRIPTION_LANGUAGE` | no | `en` | Language hint (e.g. `hi`, `en`) |
| `LLM_PROVIDER` | no | `heuristic` | `heuristic` (rule-based, no key), `groq`, `anthropic`, `openai` |
| `ANTHROPIC_API_KEY` | if anthropic | — | Anthropic key |
| `ANTHROPIC_MODEL` | no | `claude-opus-5` | Claude model for notes |
| `OPENAI_LLM_MODEL` | no | `gpt-4.1-mini` | OpenAI model for notes |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | for Google Sign-In | — | OAuth client |
| `AUDIO_STORE` | no | `local` (`postgres` on Vercel) | `local` disk or `postgres` (table `audio_blobs`; for hosts without a persistent disk) |
| `AUDIO_STORAGE_DIR` | no | `./data/audio` | Where audio segments are stored when `AUDIO_STORE=local` |
| `ALLOWED_EMAILS` | no | anyone | Comma-separated emails allowed to create an account (email or Google) |
| `PG_POOL_MAX` | no | `10` (`3` on Vercel) | Database connections per server instance |
| `NOTES_INTERVAL_SEGMENTS` | no | `6` (`15` with groq) | Incremental notes run after N new transcript lines… |
| `NOTES_MAX_WAIT_SECONDS` | no | `180` (`300` with groq) | …or after this long, whichever comes first |
| `FINAL_PASS_MAX_CHARS` | no | `120000` (`16000` with groq) | Above this transcript size the final pass works in windows (map → reduce) |
| `EXTENSION_ORIGINS` | no | any `chrome-extension://` | Comma-separated extension origins allowed by CORS, e.g. `chrome-extension://<id>` |
| `CRON_SECRET` | no | — | Bearer secret for `POST /api/cron/retention` |

**Keys you must supply for production use:** a transcription key (`GROQ_API_KEY` for free,
`DEEPGRAM_API_KEY` for speaker labels, or `OPENAI_API_KEY`), an AI key (`GROQ_API_KEY`,
`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`), and Google OAuth credentials if you want Google Sign-In.
For a zero-cost personal deployment, follow [DEPLOY-FREE.md](DEPLOY-FREE.md).

## 2. Database

Any PostgreSQL 14+ (local, Supabase, RDS, Neon).

```bash
cd web
npm install
DATABASE_URL=postgres://... npm run migrate     # applies db/migrations/*.sql, tracked in schema_migrations
DATABASE_URL=postgres://... npm run seed        # optional demo data (clearly labelled DEMO)
npm run seed -- you@company.com                 # add demo meetings to an existing account
```

**Supabase:** use the pooled connection string as `DATABASE_URL` with `DATABASE_SSL=true`. The app
connects as a server role and enforces ownership in code (`lib/meetings.ts → requireMeeting`). If you
also expose these tables through Supabase's REST API, enable RLS, for example:

```sql
alter table meetings enable row level security;
create policy own_meetings on meetings using (created_by = auth.uid());
-- repeat for child tables via: using (exists (select 1 from meetings m where m.id = meeting_id and m.created_by = auth.uid()))
```

## 3. Google Sign-In

1. Google Cloud Console → APIs & Services → Credentials → *Create OAuth client ID* → Web application.
2. Authorised redirect URI: `${APP_URL}/api/auth/google/callback`.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Scopes requested: `openid email profile` only.
4. An existing email/password account with the same verified email is linked automatically.

## 4. Chrome extension

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, choose the
   `extension/` folder.
2. In the web app go to **Settings → Chrome extension → Create extension token**; copy it.
3. Open the extension's **Options** (right-click the icon → Options). Enter the server URL (`APP_URL`)
   and the token, click **Save & test**.
4. Optional: click **Grant microphone permission** in Options so your own voice is included.
5. (Recommended in production) set `EXTENSION_ORIGINS=chrome-extension://<your extension id>`.
6. Join a Google Meet, click the extension icon, check the title, click **Start Taking Notes**,
   confirm consent.

To publish on the Chrome Web Store, zip the `extension/` folder and justify each permission with the
text in `options.html`.

## 5. Deployment

**Vercel + Neon (free):** step by step in [DEPLOY-FREE.md](DEPLOY-FREE.md). What the code does for it:
* `vercel-build` runs `npm run migrate` before `next build`, so migrations apply on every deploy.
* On Vercel, audio is stored in Postgres (`AUDIO_STORE=postgres`) because the filesystem is ephemeral.
* `web/vercel.json` schedules `/api/cron/retention` daily; Vercel sends `Authorization: Bearer $CRON_SECRET`.
* Long routes export `maxDuration = 300` so final notes (run after the response via `after()`) can finish.
* Use a direct (unpooled) Postgres URL: the notes engine takes a session-level advisory lock.

**Single server / Docker / VM:** `npm ci && npm run build && npm start` behind HTTPS (required for
microphone access in browsers). Local-disk audio storage works as is; back up `AUDIO_STORAGE_DIR`.

HTTPS is mandatory in production: browsers only allow microphone capture on secure origins.
