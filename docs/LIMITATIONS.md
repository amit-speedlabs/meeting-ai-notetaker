# Known limitations (browser, Google Meet, and this build)

## Google Meet capture
* **Needs the Chrome extension.** A website cannot read another site's audio, so Meet capture only
  works through the extension in Chrome/Chromium-based browsers (Chrome 116+).
* **Tab audio = other participants only.** Meet does not play your own voice into the tab. Your voice
  is included only if you tick "Include my microphone" and grant microphone permission once to the
  extension. If you decline, notes contain only what others said, and the popup says so.
* **Capture can be refused by Chrome.** Managed devices/enterprise policy, Meet opened as an installed
  app window, the tab already being captured, or a non-Chrome browser. The popup then shows
  "Meet audio capture is unavailable in this browser configuration." with **Use Microphone Mode** and
  **Upload Meeting Recording**. A failed start is recorded as a FAILED meeting with the reason.
* **You must click the extension on the Meet tab.** Chrome only grants tab capture after a click on
  the toolbar icon in that tab; recording cannot start automatically, on a schedule, or on another tab.
* **No participant names from Meet.** Reading names means scraping Meet's page, which is fragile and
  beyond what the user authorises, so the extension doesn't. Enter participants manually.
* **Real Google Meet was not exercised in the build environment** (it needs a Google sign-in). The
  extension was tested in Chromium against a stand-in Meet page, including real tab capture, upload,
  transcription pipeline, notes, pause/resume, stop and tab-closed handling. Run the manual checklist
  in TESTING.md once on real Meet.

## Transcription and speakers
* **Demo mode is not transcription.** With `TRANSCRIPTION_PROVIDER=mock` the server inserts a scripted
  sample conversation regardless of what is said. The UI labels this everywhere. Real transcription
  needs a Deepgram or OpenAI key; neither was available in the build environment, so those two
  adapters are implemented to the providers' documented APIs but **have not been run against the live
  services**.
* **Speaker labels are per segment.** Deepgram diarizes each 20 s segment independently, so
  "Speaker 1" in one segment is not guaranteed to be the same person in the next. OpenAI transcription
  has no diarization (lines show "Unknown Speaker"). A streaming provider would fix this; the
  `TranscriptionProvider` interface supports it. Speakers are never mapped to real names automatically.
* **Browser speech recognition** (the no-key option for offline meetings) is Chrome-only, sends audio
  to Google, has no speaker labels, and can stop on long silences (it restarts automatically).
* **Segment boundaries:** the recorder restarts every 20 s so each segment is a standalone file; a
  few milliseconds can be lost at each boundary, and words spanning a boundary may be split.
* Live transcript lags ~20–25 s behind speech (segment length + provider latency).

## AI notes
* The rule-based extractor (default without an AI key) only catches explicit patterns ("X, please…",
  "I will…", "we decided…", questions). It is deliberately conservative and misses paraphrased
  commitments; use Claude or OpenAI for real notes.
* The Groq setup (free deployment) is tested against a stand-in API that checks request shape and
  the rate-limit retry, not against Groq itself. Groq's free tier caps notes at about 2 meeting-hours
  a day; beyond that, notes fail with a clear error and can be regenerated later.
* The Claude and OpenAI adapters were not run against the live APIs in the build environment (no
  keys). Their failure path (invalid key) is tested: the meeting completes, the transcript is kept, and
  "Regenerate notes" is offered.
* Deadlines: relative phrases are resolved against the meeting date in the meeting's timezone.
  Ambiguous phrases ("before the next meeting", "05/10") keep their wording and get no date.
  "Next Friday" is resolved as the Friday of the following week, with the original wording shown.

## Offline buffering and recovery
* Unsent audio is kept in the browser's IndexedDB (or the extension's). If the browser crashes, the
  segment being recorded at that moment (≤ 20 s) is lost; everything already saved is recoverable
  from the dashboard's recovery banner. Private/incognito windows and full disks can prevent local
  buffering; the UI then says audio is buffered "in memory".
* On Stop, the app waits up to ~45 s for queued audio and then asks whether to keep waiting or finish.

## Platform / deployment
* Microphone capture needs HTTPS (or localhost).
* Local-disk audio storage does not persist on serverless hosts, so Vercel stores audio in Postgres,
  which counts against the database's size limit (0.5 GB on Neon's free plan).
* Rate limiting is in-memory per server instance.
* Google Sign-In is implemented (OAuth code flow) but was not exercised end to end without OAuth
  credentials; email/password sign-in is fully tested.
* Calendar integration is not built (V1 scope); `meetings.external_event_id`/`calendar_source` and a
  dashboard "Upcoming" slot are reserved for it.
