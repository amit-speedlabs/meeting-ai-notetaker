# Testing

## Automated

```bash
cd web
npm test            # 34 unit tests (vitest)
npm run typecheck
npm run test:e2e    # 18 Playwright tests (browser + API), see servers below
```

The e2e suite expects the app built and running:

| Server | Command (from `web/`, with `.env.local` loaded) | Used by |
|---|---|---|
| `:3000` normal (mock transcription, rule-based notes) | `npm start` | all browser tests |
| `:3001` failing providers | `MOCK_TRANSCRIPTION_FAIL=1 LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=invalid npx next start -p 3001` | provider-failure tests |
| `:3002` small final-pass window | `FINAL_PASS_MAX_CHARS=3000 npx next start -p 3002` | long-meeting test |
| `:3003` free deployment settings | `TRANSCRIPTION_PROVIDER=groq LLM_PROVIDER=groq GROQ_API_KEY=test-key GROQ_BASE_URL=http://127.0.0.1:4010/openai/v1 AUDIO_STORE=postgres ALLOWED_EMAILS=owner@example.com npx next start -p 3003`, plus `node tests/fakes/openai-compatible.mjs` (stand-in Groq API on :4010) | `free-stack.spec.ts` |

Set `CHROMIUM_PATH` if Playwright should use a specific Chromium. Browser tests use Chromium's fake
microphone (`--use-fake-device-for-media-stream`). Two localStorage test hooks shorten segments
(`mt_segment_ms`) and disable silence skipping (`mt_silence_threshold=0`) because the fake microphone
beeps intermittently.

### What the automated tests cover (last run: all 34 unit + 18 e2e passing)

| PRD §51 item | Test |
|---|---|
| Offline: start, mic permission, recording indicator, timer, audio received, transcript, live notes, pause/resume, stop, final notes | `offline.spec.ts` |
| Speaker labels, rename speakers (owners follow the rename), transcript search + jump, action complete/add, decisions tab, activity log, delete audio keep transcript, PDF/DOCX/MD/TXT export, global search, library filters | `offline.spec.ts` |
| Google Meet: extension loads, minimal permissions, Meet detected, popup, consent, capture refused → "unavailable" + fallbacks | `extension.spec.ts` #1 |
| Google Meet: tab capture → segments uploaded → live transcript in popup → notes → pause/resume → on-page badge → stop → final notes, participants, audio stored | `extension.spec.ts` #2 |
| Meeting ended unexpectedly (Meet tab closed mid-recording) | `extension.spec.ts` #3 |
| Microphone denied | `mic-denied.spec.ts` |
| Network failure (offline → buffered locally → uploaded on reconnect) | `failures.spec.ts` |
| Browser refresh during recording → recovery → finish | `failures.spec.ts` |
| Transcription API failure (503, retried by client, error surfaced) | `api.spec.ts` |
| AI API failure (meeting completes, transcript kept, clear error, regenerate) | `api.spec.ts` |
| Long meeting (2 h = 360 segments, paginated transcript, windowed final pass, no duplicate actions) | `api.spec.ts` |
| No speech (silent segments skipped, "No speech was captured") | `api.spec.ts` |
| Multiple speakers | demo provider emits 3 speakers; `offline.spec.ts` renames them |
| Upload recording fallback | `upload.spec.ts` |
| Access control (other users get 404; unauthenticated 401), consent required | `api.spec.ts` |
| AI extraction: summary, decisions, actions, owners, deadlines, open questions, risks; never invent owners/deadlines | `tests/unit/heuristic.test.ts` |
| Deadline interpretation (tomorrow, Friday, next week, month-end, explicit dates; ambiguous kept as text) | `tests/unit/deadline.test.ts` |

### How the Meet extension is tested without Google Meet

`meet.google.com` is routed to a local page that plays a tone (the real Meet requires a Google
sign-in). Chrome grants `tabCapture` only after the user clicks the extension's toolbar button, which
automation cannot do, so test #2/#3 start Chromium with its `--allowlisted-extension-id` test switch
to stand in for that click. Test #1 runs without it and verifies the refusal path.

## Manual checklist (run once with real keys and a real Meet)

These need a human, a Google account and real API keys; they were **not** run in the build
environment.

**Google Meet**
1. Load the extension, connect it (Options → Save & test shows "Connected as …").
2. Join a real Meet with a second participant on another device.
3. Click the extension → "Google Meet detected", title pre-filled from the Meet tab title.
4. Tick "Include my microphone" (grant once if asked) → Start Taking Notes → consent → confirm.
5. Check: red REC badge on the icon, "● Recording — Meeting AI is taking notes" on the Meet page,
   Chrome's own tab-sharing indicator, and that you can still hear the other participant.
6. Speak from both sides for 2–3 minutes; transcript lines appear in the popup about every 20 s,
   notes after ~2 minutes; both voices are present.
7. Pause (no new lines), Resume, Stop → "Meeting stopped" → Open meeting notes → final summary.

**Offline**
1. Dashboard → + Offline Meeting → title, participants → Start → consent → browser mic prompt.
2. Talk for a few minutes including: "Amit, please send the school list by tomorrow", "I will share
   the update on Friday", "We decided to use the CoE channel", "Is Gujarat confirmed?".
3. Stop → check owners/deadlines: Amit / tomorrow's date; your speaker label / Friday's date; the
   decision; the open question.

**Failure checks:** deny the mic; turn Wi-Fi off for a minute mid-meeting (audio status goes
BUFFERING/DISCONNECTED, then recovers); close the tab mid-meeting and reopen the dashboard (recovery
banner); set an invalid API key and confirm the error message is clear.
