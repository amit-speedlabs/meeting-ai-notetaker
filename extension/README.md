# Meeting AI Notetaker — Chrome extension (Manifest V3)

| File | Role |
|---|---|
| `manifest.json` | Permissions: `tabCapture`, `offscreen`, `activeTab`, `storage`; content script on `https://meet.google.com/*` only |
| `background.js` | Service worker: state machine (idle → recording ⇄ paused → stopping → finished), creates the meeting via the API, gets the tab stream id |
| `offscreen.html/js` | Holds the tab (+ mic) stream, keeps the tab audible, records 20 s self-contained segments, uploads through an IndexedDB retry queue |
| `content.js/css` | On Meet only: reports meeting code/title, shows the on-page "● Recording" badge |
| `popup.*` | UI: detection, title/type/participants, consent, recording status, live transcript, pause/resume/stop, fallbacks |
| `options.*` | Server URL + personal access token, permission explanations |
| `permission.*` | One-time microphone grant for the extension origin |

Install: `chrome://extensions` → Developer mode → Load unpacked → this folder. Then see `docs/SETUP.md`.
