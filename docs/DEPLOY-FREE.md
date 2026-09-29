# Deploy for free (personal use)

This puts the notetaker online for one person at no cost:

| Piece | Service | Free plan |
|---|---|---|
| Web app + API | **Vercel** Hobby | Free for personal, non-commercial use. Functions can run up to 300 s. |
| Database (and stored audio) | **Neon** Postgres Free | 0.5 GB per project, 100 compute-hours a month, no credit card. It sleeps after 5 idle minutes and wakes on the next request (the first page load after a break is a little slower). |
| Transcription + AI notes | **Groq** free tier | One key covers both. Whisper transcription: about 2 hours of audio per hour, 8 hours per day. Notes model (`openai/gpt-oss-120b`): 200K tokens per day, which is roughly 2 hours of meetings of AI notes per day. |
| Chrome extension | Loaded unpacked | No Chrome Web Store fee needed for your own use. |

Limits are the providers' published free-tier numbers as of September 2026 and can change.

## What you do (about 20 minutes)

### 1. Neon (database)
1. Sign up at neon.com and create a project. Pick the region closest to you (for India: AWS Singapore).
2. On the project dashboard, click **Connect**, turn **Connection pooling off**, and copy the connection
   string. It looks like `postgresql://user:pass@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.
   Use the direct (unpooled) string: the notes engine uses a session lock that a pooler would break.

### 2. Groq (transcription and notes)
1. Sign up at console.groq.com.
2. Open **API Keys**, create a key, and copy it (`gsk_…`). It is shown only once.

### 3. Vercel (the app)
1. Sign up at vercel.com with your GitHub account.
2. **Add New → Project**, import the GitHub repository that holds this code.
3. Set **Root Directory** to `web`. Leave the framework as Next.js.
4. Add these **Environment Variables** before the first deploy:

| Name | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string from step 1 |
| `AUTH_SECRET` | a long random string (run `openssl rand -hex 32`, or mash the keyboard for 40+ characters) |
| `TRANSCRIPTION_PROVIDER` | `groq` |
| `LLM_PROVIDER` | `groq` |
| `GROQ_API_KEY` | the key from step 2 |
| `ALLOWED_EMAILS` | your email address; nobody else can create an account |
| `CRON_SECRET` | another random string; lets Vercel run the daily audio-retention clean-up |
| `TRANSCRIPTION_LANGUAGE` | `en`, or `hi` for Hindi meetings |

5. Click **Deploy**. The build runs the database migrations automatically (`vercel-build`).
6. When it finishes, copy your site address (for example `https://meeting-notes-amit.vercel.app`).
   Add one more variable, `APP_URL` = that address, then **Deployments → ⋯ → Redeploy**.
   (`APP_URL` is used for share links and Google sign-in.)

### 4. First sign-in
1. Open your site, choose **Create account**, and sign up with the email you put in `ALLOWED_EMAILS`.
2. Open **Settings**. Set audio retention to **7 days** (or turn audio storage off). Audio lives in the
   0.5 GB database: recorded meetings take roughly 15–25 MB per hour, and uploaded recordings much more.
   Transcripts and notes are small and are kept either way.
3. Check that the start screen shows no "demo transcription" banner. If it does, a variable is missing.

### 5. Chrome extension (for Google Meet)
1. Download the `extension` folder from the repository (or unzip the project zip).
2. In Chrome open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the
   `extension` folder.
3. In the web app's **Settings**, click **Create extension token** and copy it.
4. Open the extension's options (right-click its icon → **Options**). Paste your site address as
   **Server URL** and the token as **Extension token**, then save.
5. Join a Meet call, click the extension icon, confirm consent, and press Start. Chrome asks you to
   allow tab audio; the extension never records without that click.
6. Optional hardening: copy the extension ID from `chrome://extensions` and add the Vercel variable
   `EXTENSION_ORIGINS` = `chrome-extension://<that id>`, then redeploy.

Offline (in-person) meetings need nothing extra: use **Start offline meeting** in the web app on any
device with a microphone. The site is HTTPS, which browsers require for microphone access.

## What you get on the free setup, honestly
* **No speaker names from Groq.** Whisper does not tell voices apart, so lines are not labelled by
  speaker. Action-item owners still come from names said in the meeting. If you want speaker labels,
  switch transcription to Deepgram (`TRANSCRIPTION_PROVIDER=deepgram`, `DEEPGRAM_API_KEY`), which gives
  new accounts free credit.
* **Daily caps.** Past Groq's daily token cap, notes for that meeting fail with a clear message; the
  transcript is kept and **Regenerate notes** works the next day. Transcription past its cap is retried
  from the browser's buffer.
* **Zero-key fallback.** Offline meetings can use **Browser speech recognition** (Chrome's built-in,
  free, sends mic audio to Google) with the rule-based notes extractor (`LLM_PROVIDER=heuristic`). Notes
  are basic but cost nothing and need no account.
* **Privacy.** Audio goes to Groq for transcription and transcript text goes to Groq for notes. Read
  Groq's data policy before recording anything sensitive.
* The Groq setup was tested against a stand-in server that checks every request our code sends
  (`tests/e2e/free-stack.spec.ts`), not against Groq itself, because no Groq key was available while
  building. If the first real meeting shows an error, the message names the provider and status code.

## Updating later
Push to the repository's main branch and Vercel redeploys on its own; new migrations run during the
build.
