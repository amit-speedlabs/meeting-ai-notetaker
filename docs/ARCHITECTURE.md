# Meeting AI Notetaker — Constraints, Architecture & Design

This document covers PRD §53 steps 1–8, written before the build. It is the reference for how the
code in `web/` and `extension/` is organised and why.

---

## 1. Requirements analysis (condensed)

Two capture modes feed one pipeline:

| Mode | Capture surface | Who gives permission |
|---|---|---|
| Google Meet | Chrome extension, `chrome.tabCapture` on the Meet tab (+ optional mic) | User clicks the extension action → Chrome grants tab capture for that tab only; mic prompt shown by Chrome |
| Offline / in-person | Web app, `getUserMedia({audio})` + `MediaRecorder` | Browser mic prompt |
| Upload (fallback) | Web app, user picks an audio/video file | File picker |

All three produce **audio segments** → server → **TranscriptionProvider** → transcript segments in
Postgres → **incremental AI notes** every few minutes → **final pass** on stop.

MVP list (§49) maps to: auth (email/password + Google OAuth), dashboard, library with filters/sort,
meeting detail with 8 tabs, transcript + global search (Postgres FTS), action item CRUD with
statuses, exports (PDF/DOCX/MD/TXT + copy), audio retention settings + delete-audio-keep-transcript,
share link, demo data, error handling, recovery.

Out of scope for V1 (§50) is not built. Calendar is designed for (see §9) but not implemented.

---

## 2. Browser / Google Meet technical constraints (honest list)

1. **A normal website cannot read Google Meet audio.** Meet runs in its own origin; no web API lets
   another origin read its audio. Hence the extension.
2. **`chrome.tabCapture` requires a user gesture on the extension** (clicking the toolbar icon /
   popup button). It captures only the tab the user invoked it on. We cannot start capture
   automatically or on another tab. This is the permission model we want anyway.
3. **In MV3, a service worker cannot hold a `MediaStream`.** We get a stream id with
   `chrome.tabCapture.getMediaStreamId({targetTabId})` and consume it in an **offscreen document**
   (`chrome.offscreen`, reason `USER_MEDIA`), which records with `MediaRecorder`.
4. **Captured tab audio is muted for the user unless re-played.** The offscreen document routes the
   stream back to the speakers through an `AudioContext` so the user still hears the meeting.
5. **Tab audio contains the *other* participants, not the user's own voice** (Meet does not play
   your own mic back to you). To include the user's voice the extension also captures the
   microphone and mixes both. An offscreen document cannot show a permission prompt, so the
   extension opens a one-time `permission.html` page where the user grants mic access to the
   extension origin. If they decline, capture continues with tab audio only and the popup says so.
6. **Speaker names in Meet are not exposed via any API.** Reading them would mean scraping Meet's
   DOM (fragile, and outside "only what the user authorised"). V1 does **not** scrape participant
   names. Speakers come from the transcription provider's diarization (Speaker 1, 2 …) or show as
   "Unknown Speaker"; users rename speakers after the meeting. Participants are entered manually.
7. **Diarization across chunks.** Chunk-based providers diarize each chunk independently, so
   "Speaker 1" in chunk 4 may not be "Speaker 1" in chunk 5. We use longer segments (≈20 s) to
   reduce this and label speakers per provider output; a streaming (WebSocket) provider adapter would
   fix it and the interface allows it (see §7). We never map a diarized speaker to a real name
   automatically.
8. **`MediaRecorder` timeslice chunks are not independently decodable** (only the first has the
   WebM header). We therefore **stop/restart the recorder every N seconds** so each segment is a
   complete file any provider can decode. A few ms of audio can be lost at each boundary.
9. **Tab capture can be unavailable**: enterprise policy (`TabCaptureAllowedByOrigins`, etc.),
   non-Chrome browsers, Meet in a PWA window, the tab already captured, or the popup opened on a
   non-Meet tab. The extension surfaces the exact error with the text
   "Meet audio capture is unavailable in this browser configuration." and offers
   **Use Microphone Mode** and **Upload Meeting Recording** (both open the web app).
10. **Local buffering limits.** Unsent segments are queued in IndexedDB (web app) and in the
    offscreen document's memory + IndexedDB (extension). If the browser itself crashes, whatever was
    persisted to IndexedDB is recoverable; audio that was still inside the active recorder segment
    (≤ one segment) is lost. Storage quota can be exceeded on very long offline periods; the UI
    shows the queue size.
11. **Browser speech recognition (Web Speech API)** is available as a no-API-key transcription
    option in Chrome for the microphone mode only. It sends audio to Google's speech service; the UI
    discloses that. It cannot transcribe tab audio or uploaded files.

---

## 3. System architecture

```
┌──────────────── Chrome ────────────────┐        ┌──────────── Next.js server ────────────┐
│ Web app (React)                         │        │ /api/auth/*        sessions, Google OAuth │
│  • Offline mode: getUserMedia →         │ HTTPS  │ /api/meetings/*    CRUD, lifecycle        │
│    SegmentRecorder → UploadQueue(IDB) ──┼───────▶│ /api/meetings/:id/segments  audio in      │
│  • Upload mode: decode → WAV chunks ────┤        │      → TranscriptionProvider              │
│  • Live page polls transcript/notes     │        │      → transcript_segments                │
│                                         │        │      → NotesEngine (incremental, final)   │
│ Extension (MV3)                         │        │ /api/search, /api/actions, /api/export    │
│  popup → service worker → offscreen ────┼───────▶│ AudioStore (local FS | S3-compatible)     │
│  content script: Meet detection + badge │ Bearer │ Postgres (users, meetings, segments, …)  │
└─────────────────────────────────────────┘ token  └───────────────────────────────────────────┘
```

* **Frontend:** Next.js 15 App Router, React 19, plain CSS (no UI kit).
* **Backend:** Next.js route handlers (Node runtime). No separate service needed for V1.
* **DB:** PostgreSQL (plain SQL migrations — works unchanged on Supabase Postgres).
* **Audio storage:** `AudioStore` interface; `local` (disk) implementation in V1, S3/Supabase
  Storage is a drop-in.
* **Auth:** own session table with httpOnly, `SameSite=Lax`, `Secure` (in prod) cookies;
  email/password (scrypt) + Google OAuth 2.0 authorization-code flow. Extension uses a personal
  access token (hashed at rest, revocable) sent as `Authorization: Bearer`.
* **Secrets:** only on the server via env vars. Nothing provider-related reaches the browser.

### API surface

| Method & path | Purpose |
|---|---|
| `POST /api/auth/register`, `/login`, `/logout`; `GET /api/auth/google`, `/google/callback` | Auth |
| `GET/POST /api/meetings` | List (filters, sort, pagination) / create |
| `GET/PATCH/DELETE /api/meetings/:id` | Detail / edit title, type, speaker map / delete all data |
| `POST /api/meetings/:id/start` `…/pause` `…/resume` `…/stop` | Lifecycle; `stop` runs final notes |
| `POST /api/meetings/:id/segments` | Upload one audio segment (multipart: audio, seq, startMs, durationMs) → transcribes |
| `POST /api/meetings/:id/transcript` | Append client-side transcribed text (browser speech mode) |
| `GET /api/meetings/:id/transcript?offset&limit&q` | Paginated transcript / in-meeting search |
| `GET /api/meetings/:id/live` | Status + new segments since cursor + current notes (polled every 3 s) |
| `POST /api/meetings/:id/notes/regenerate` | Force a notes pass |
| `GET/DELETE /api/meetings/:id/audio` | Stream audio / delete audio keep transcript |
| `GET /api/meetings/:id/export?format=pdf|docx|md|txt` | Export |
| `POST/DELETE /api/meetings/:id/share` | Create / revoke public read-only link |
| `GET/POST /api/actions`, `PATCH/DELETE /api/actions/:id`, `POST /api/actions/:id/comments` | Action items |
| `GET /api/search?q=` | Global search |
| `GET/PATCH /api/settings`, `POST/DELETE /api/tokens` | Retention settings, extension tokens |
| `GET /api/health` | Provider + DB status (used by extension) |

---

## 4. Database schema

See `web/db/migrations/001_init.sql` for the executable version. Summary:

```
users(id, email UNIQUE, name, password_hash NULL, google_sub NULL UNIQUE, role 'user'|'admin', created_at)
sessions(id, user_id→users, token_hash UNIQUE, expires_at, created_at)
api_tokens(id, user_id→users, name, token_hash UNIQUE, last_used_at, created_at, revoked_at)
user_settings(user_id PK→users, store_audio bool, retention_days int NULL /*NULL = until deleted*/,
              transcription_provider text NULL)
meetings(id, created_by→users, title, meeting_type, mode 'meet'|'offline'|'upload',
         status NOT_STARTED|RECORDING|PAUSED|PROCESSING|COMPLETED|FAILED,
         transcription_status CONNECTING|TRANSCRIBING|PAUSED|COMPLETED|FAILED,
         start_time, end_time, duration_seconds, active_ms /*excludes pauses*/,
         speaker_map jsonb, is_demo bool, share_token UNIQUE NULL,
         last_activity_at, notes_cursor int /*last transcript seq processed*/,
         error text NULL, provider text, created_at, updated_at)
participants(id, meeting_id→meetings CASCADE, name, email, organisation)
transcript_segments(id, meeting_id CASCADE, seq, offset_ms, speaker, text, confidence NULL,
                    chunk_seq, created_at, tsv tsvector GENERATED, UNIQUE(meeting_id, seq))
audio_chunks(id, meeting_id CASCADE, chunk_seq, start_ms, duration_ms, mime, bytes,
             storage_key, status received|transcribed|failed, error, created_at, UNIQUE(meeting_id, chunk_seq))
notes(meeting_id PK CASCADE, summary, key_points jsonb, decisions jsonb, open_questions jsonb,
      risks jsonb, follow_ups jsonb, important_numbers jsonb, topics jsonb, next_steps jsonb,
      is_final bool, provider, updated_at)
action_items(id, meeting_id CASCADE, task, owner, deadline_date NULL, deadline_text,
             status pending|in_progress|completed|cancelled, source 'ai'|'manual',
             source_quote, created_at, updated_at)
action_comments(id, action_id CASCADE, user_id, body, created_at)
activity_log(id, meeting_id CASCADE, user_id, kind, detail jsonb, created_at)
```

Access control: every query is scoped by `meetings.created_by = current user` (checked in one helper,
`requireMeeting`). Role column exists for admin tooling later. On Supabase, the same predicate
becomes an RLS policy (`created_by = auth.uid()`); the SQL for that is in `docs/SETUP.md`.

Idempotency: `audio_chunks(meeting_id, chunk_seq)` is unique, so a retried upload after a network
blip does not duplicate transcript text.

---

## 5. Extension architecture (MV3)

```
extension/
  manifest.json      permissions: tabCapture, offscreen, storage, activeTab
                     host_permissions: none required (API origin set by user; fetch from
                     offscreen uses Bearer token, CORS allowed by server for chrome-extension://)
                     content_scripts: only https://meet.google.com/*
  background.js      service worker: state machine, talks to popup/offscreen/content, owns meeting id
  offscreen.html/js  holds MediaStreams, mixes tab + mic, SegmentRecorder, upload queue (IDB)
  content.js         Meet page only: reports meeting code/title, shows on-page "● Recording" badge
  popup.html/js      UI from PRD §21; Start / Pause / Resume / Stop, live transcript tail
  permission.html/js one-time microphone permission grant for the extension origin
  options.html/js    server URL + personal access token
```

Flow: popup detects Meet via the active tab URL (visible through activeTab after the toolbar click)
or, as a second signal, a reply from the content script (which only runs on meet.google.com) →
user fills title/type → consent dialog → **Start Taking Notes** (user gesture) →
`getMediaStreamId({targetTabId})` → background creates meeting via API → creates offscreen doc →
offscreen `getUserMedia({audio:{mandatory:{chromeMediaSource:'tab', chromeMediaSourceId}}})`
(+ mic if granted) → mix → segments → `POST /segments`. Content script shows the badge; Chrome
itself also shows its tab-capture indicator. Stop → `POST /stop` → final notes.
If Chrome refuses capture, the meeting is marked FAILED with the reason and the popup shows the
fallbacks. Closing the Meet tab or leaving the call mid-recording finishes the meeting with the audio
captured so far.

Why no `<all_urls>`/`tabs`: `activeTab` + tabCapture is enough; URL of the active tab is visible to
the popup after the user clicks the action (activeTab grant). The content script runs only on Meet.

---

## 6. Audio capture flow

```
getUserMedia / tabCapture stream
   → (extension) AudioContext mix: tab + mic → MediaStreamDestination; tab also → speakers
   → SegmentRecorder: MediaRecorder(opus/webm), restarted every SEGMENT_MS (default 20 s)
   → Blob segment {seq, startMs (active-time offset), durationMs}
   → UploadQueue: IndexedDB put → POST → on 2xx delete; on failure exponential backoff (1 s…30 s)
        audio status: CONNECTED (queue empty) | BUFFERING (queue > 0, online) | DISCONNECTED (offline / repeated failures)
   → pause: recorder stopped, segment flushed; resume: new segment starts; offsets use active time
   → stop: flush last segment, wait for queue to drain (with timeout + "keep waiting / finish anyway"), POST /stop
```

Upload fallback: file → `AudioContext.decodeAudioData` → resample to 16 kHz mono → 60 s WAV chunks →
same queue. Keeps one code path on the server.

Recovery: the active meeting id + queue live in IndexedDB. On app load, if IDB has unsent segments
or the server reports a meeting in RECORDING/PAUSED with no activity for > 2 min, the dashboard
shows a **Recover meeting** banner: upload queued audio, then *Finish & generate notes* or
*Discard*.

---

## 7. Transcription abstraction

```ts
interface TranscriptionProvider {
  readonly id: string; readonly label: string;
  readonly supportsDiarization: boolean; readonly sendsAudioToThirdParty: boolean;
  start(ctx: { meetingId; language? }): Promise<void>;
  sendAudioChunk(chunk: { seq; data: Buffer; mime; startMs; durationMs }): Promise<void>;
  receiveTranscript(): Promise<TranscriptPiece[]>;   // pieces produced since last call
  pause(): Promise<void>; resume(): Promise<void>; stop(): Promise<TranscriptPiece[]>;
}
TranscriptPiece = { startMs, endMs, speaker: string|null, text, confidence: number|null }
```

Implementations (selected with `TRANSCRIPTION_PROVIDER`):

| id | Notes |
|---|---|
| `openai` | `POST /v1/audio/transcriptions` per segment (`OPENAI_TRANSCRIBE_MODEL`, default `gpt-4o-mini-transcribe`). No diarization → "Unknown Speaker". |
| `deepgram` | `POST /v1/listen?diarize=true&smart_format=true&utterances=true` per segment. Speakers "Speaker N" (chunk-local, see §2.7). |
| `mock` | **Demo only.** Does not listen to the audio. Emits a scripted sample conversation, one line per segment, flagged `is_demo_transcript`. Exists so the full pipeline can be tested without keys; the UI shows a banner whenever it is active. |
| `browser` | Client-side Web Speech API (offline mic mode only). Server receives text, not audio, via `/transcript`. |

The server keeps no provider state between HTTP requests (chunk providers are stateless), so a
provider instance is created per request and `start → sendAudioChunk → receiveTranscript` runs
inside one request. A streaming provider (Deepgram live, AssemblyAI realtime) would run in a
long-lived worker and implement the same interface.

Silence handling: segments whose RMS is below a threshold are marked on the client (`silent=1`)
and the server skips the provider call (cost control, "No speech" test case).

---

## 8. AI processing architecture

```ts
interface LLMProvider { id; label; completeJSON<T>(req: { system; user; schema: ZodType<T> }): Promise<T> }
```

Implementations (`LLM_PROVIDER`): `anthropic` (Claude via `@anthropic-ai/sdk`, structured outputs,
model `ANTHROPIC_MODEL`, default `claude-opus-5`), `openai` (chat completions JSON schema),
`heuristic` (no-key, rule-based extractor — deterministic, conservative, used for demo and tests).

**NotesEngine** (provider-independent):

1. *Incremental pass* — triggered when ≥ `NOTES_INTERVAL_SEGMENTS` new segments exist since
   `notes_cursor` (default ≈ 2 min of audio) or 3 minutes have passed. Input = current notes JSON
   (compact) + **only new transcript lines**. Output = updated notes JSON. Cost is O(new text).
2. *Final pass* — once on stop. If transcript ≤ `FINAL_PASS_MAX_CHARS` (default 120k chars) the
   full transcript is sent once; otherwise the running notes + transcript compressed to one line per
   speaker turn with fillers removed, split into windows that are summarised then merged (map →
   reduce), so the full transcript is never re-sent.
3. *Post-processing (deterministic, not LLM):*
   - Owners: kept only if the name appears in the transcript text, the participant list, or the
     speaker map; otherwise → "Unassigned". Never invented.
   - Deadlines: the LLM returns the verbatim phrase (`deadline_text`); `resolveDeadline(phrase,
     meetingDate)` converts today / tomorrow / weekday / next week / end of week / month-end /
     explicit dates / "by 6 PM" → ISO date. Ambiguous phrases ("before the next meeting", "soon")
     keep the text and no date. No phrase → "Not specified".
   - Action-item merge: new AI items are de-duplicated against existing ones by normalised task
     text; user-edited items (source manual or edited) are never overwritten by later passes.

Output JSON (validated with zod):

```json
{ "summary": "", "discussion_points": [], "decisions": [], "action_items":
  [{ "task": "", "owner": "", "deadline_text": "", "source_quote": "" }],
  "open_questions": [], "risks": [], "follow_ups": [], "important_numbers": [],
  "topics": [], "next_steps": [] }
```

Failure handling: provider errors are caught per pass; the meeting keeps its previous notes and
records `error`; the live UI shows "AI notes temporarily unavailable — retrying". A failed final
pass leaves the meeting `COMPLETED` with transcript intact and a **Regenerate notes** button.

---

## 9. Extensibility hooks

* **Calendar:** `meetings.external_event_id` / `calendar_source` columns reserved; a
  `CalendarProvider` interface (`listUpcoming()`) can populate "Upcoming" on the dashboard and
  pre-fill the create form.
* **Storage:** `AudioStore` (`put/get/delete/stream`) — local disk now, S3/Supabase later.
* **Providers:** add a file under `lib/transcription/` or `lib/llm/` and register it.
