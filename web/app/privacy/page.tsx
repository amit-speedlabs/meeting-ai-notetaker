import Link from 'next/link';

export default function Privacy() {
  return (
    <main style={{ maxWidth: 780, margin: '0 auto' }}>
      <div className="panel stack">
        <h1>Privacy &amp; your data</h1>
        <section>
          <h2>When recording is active</h2>
          <p>Audio is captured only after you click a start button and confirm the consent notice. While audio is being captured, the app shows a red <b>● Recording</b> indicator and a running timer. In Google Meet, the extension also shows a badge on the Meet page and Chrome shows its own tab-sharing indicator. There is no background or hidden recording.</p>
        </section>
        <section>
          <h2>What is captured</h2>
          <ul className="clean">
            <li><b>Offline meetings:</b> the microphone you allow in the browser prompt.</li>
            <li><b>Google Meet:</b> the audio of the one Meet tab where you clicked <i>Start Taking Notes</i>, plus your microphone if you allow it. Other tabs are never captured. Meet participant names are not read from the page.</li>
            <li><b>Uploads:</b> the file you choose.</li>
          </ul>
        </section>
        <section>
          <h2>Where data is stored</h2>
          <p>Meetings, transcripts, notes and action items are stored in this deployment&apos;s PostgreSQL database. Audio (if you keep it) is stored in this deployment&apos;s audio storage. Only your account can see your meetings; share links expose only the summary and action items.</p>
        </section>
        <section>
          <h2>Third-party processing</h2>
          <p>Depending on how the server is configured, audio segments are sent to a speech-to-text provider (Groq, OpenAI or Deepgram) and transcript text is sent to an AI provider (Groq, Anthropic or OpenAI) to produce notes. If you choose browser speech recognition, Chrome sends your microphone audio to Google&apos;s speech service. The active providers are listed in <Link href="/settings">Settings</Link> and on the start screen before you record.</p>
        </section>
        <section>
          <h2>Retention and deletion</h2>
          <p>You choose whether audio is kept and for how long (1, 7, 30 or 90 days, or until you delete it) in <Link href="/settings">Settings</Link>. On any meeting you can <b>Delete Audio, Keep Transcript</b> from the Audio tab, or delete the whole meeting (transcript, notes, actions and audio) from the Overview tab.</p>
        </section>
      </div>
    </main>
  );
}
