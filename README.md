# Meeting AI Notetaker

Start meeting → listen → transcribe → understand → take notes → extract actions → search later.

A web app (Next.js + PostgreSQL) and a Chrome extension (Manifest V3) that capture meeting audio **only
after explicit user action and consent**, transcribe it in chunks, generate live and final structured
notes (summary, decisions, action items with owners and deadlines, questions, risks, numbers), and
make everything searchable and exportable.

| Mode | How audio is captured |
|---|---|
| **Google Meet** | Chrome extension → `chrome.tabCapture` on the Meet tab you started it on (+ your mic, optional) |
| **Offline meeting** | Web app → `getUserMedia` microphone + `MediaRecorder` |
| **Upload recording** (fallback) | Web app → file decoded in the browser, sent as 60 s WAV chunks |

**Go live for free:** see [docs/DEPLOY-FREE.md](docs/DEPLOY-FREE.md) (Vercel + Neon + Groq).

## Repository layout

```
docs/
  ARCHITECTURE.md   constraints, architecture, schema, extension, audio flow, provider abstractions (PRD §53)
  SETUP.md          env vars, database, Google Sign-In, extension install, deployment
  TESTING.md        automated tests + manual test checklist (PRD §51)
  LIMITATIONS.md    known browser / Google Meet limitations and what was verified
web/                Next.js app (UI + API routes), SQL migrations, seed script, tests
  db/migrations/    PostgreSQL schema (Supabase compatible)
  lib/transcription TranscriptionProvider: openai, deepgram, mock (demo)
  lib/llm           LLMProvider: anthropic (Claude), openai, heuristic (rule-based)
  lib/notes-engine  incremental + final notes, owner validation, deadline resolution
extension/          Chrome extension (service worker, offscreen capture, content script, popup)
```

## Quick start (local)

```bash
# 1. PostgreSQL 14+ running locally, then:
cd web
cp .env.example .env.local          # edit DATABASE_URL etc.
npm install
npm run migrate
npm run seed                        # optional: demo user demo@example.com / demo12345 with 3 DEMO meetings
npm run build && npm start          # http://localhost:3000   (or: npm run dev)
```

Out of the box, `TRANSCRIPTION_PROVIDER=mock` and `LLM_PROVIDER=heuristic` so everything runs without
API keys. **The mock provider does not transcribe your audio** — it inserts a scripted sample
conversation, and the UI says so on every start screen. For real transcripts, set one of:

| You want | Set |
|---|---|
| Real speech-to-text | `TRANSCRIPTION_PROVIDER=deepgram` + `DEEPGRAM_API_KEY` (speaker labels) **or** `TRANSCRIPTION_PROVIDER=openai` + `OPENAI_API_KEY` |
| AI notes | `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` (default model `claude-opus-5`) **or** `LLM_PROVIDER=openai` + `OPENAI_API_KEY` |
| Google Sign-In | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` |

Without a transcription key, offline meetings can still get real transcripts via the browser's
built-in speech recognition (Chrome), which the start form offers and discloses.

Chrome extension: see [docs/SETUP.md](docs/SETUP.md#chrome-extension).

## Tests

```bash
cd web
npm test                 # unit tests: deadline resolution, action/decision extraction
npm run test:e2e         # browser + API tests (needs the app running; see docs/TESTING.md)
```

## Security & privacy summary

* Auth: email/password (scrypt) and Google OAuth; httpOnly `SameSite=Lax` session cookies; extension
  uses revocable personal access tokens (hashed at rest). Login is rate limited.
* Every meeting query is scoped to its owner; share links expose only the summary and actions.
* API keys live only in server environment variables; nothing provider-related reaches the browser.
* Consent dialog before every capture, a visible **● Recording** indicator + timer while capturing
  (and a badge on the Meet page), no hidden or background recording.
* Configurable audio retention (keep / don't keep; 1/7/30/90 days / until deleted), "Delete Audio,
  Keep Transcript", and full meeting deletion.
