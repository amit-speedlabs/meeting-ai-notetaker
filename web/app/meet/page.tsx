import Link from 'next/link';
import AppShell from '@/components/AppShell';
import ProviderBanner from '@/components/ProviderBanner';
import { q } from '@/lib/db';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

export default function MeetMode() {
  return (
    <AppShell>
      {async (user) => {
        const live = await q(`select id, title, status from meetings where created_by = $1 and mode = 'meet' and status in ('RECORDING','PAUSED','PROCESSING') order by created_at desc limit 5`, [user.id]);
        return (
          <div className="stack" style={{ maxWidth: 820 }}>
            <h1>Take notes from a Google Meet</h1>
            <ProviderBanner />
            {live.length > 0 && (
              <div className="alert info">
                Active Meet session{live.length > 1 ? 's' : ''}: {live.map((m: any) => <Link key={m.id} href={`/meetings/${m.id}/record`} style={{ marginRight: 10 }}>{m.title} (live view)</Link>)}
              </div>
            )}
            <div className="panel">
              <h2>How it works</h2>
              <ol>
                <li>Install the <b>Meeting AI Notetaker</b> Chrome extension (see <code>extension/README.md</code>; load it unpacked from <code>chrome://extensions</code>).</li>
                <li>In <Link href="/settings">Settings</Link>, create an extension token. Open the extension&apos;s options and enter the server URL <code>{config.appUrl}</code> and the token.</li>
                <li>Open Google Meet and start or join the meeting.</li>
                <li>Click the extension icon, enter the meeting title, then click <b>Start Taking Notes</b> and confirm the consent notice.</li>
                <li>Chrome asks nothing extra for the tab audio because you invoked the extension on that tab; if you choose to include your microphone, Chrome asks for microphone permission once.</li>
                <li>Watch the live transcript and notes in the popup or in this app (the meeting appears on the dashboard). Click <b>Stop</b> when done to generate the final summary.</li>
              </ol>
            </div>
            <div className="panel">
              <h2>What the extension can and cannot capture</h2>
              <ul className="clean">
                <li>It captures the audio of the Meet tab you started it on (the other participants). It cannot see other tabs.</li>
                <li>Your own voice is not in the tab audio; tick <i>Include my microphone</i> in the popup to add it.</li>
                <li>Participant names are not read from Meet. Speakers appear as Speaker 1, 2… when the transcription service can separate voices, and you can rename them afterwards.</li>
                <li>Tab capture can be blocked by browser policy (managed Chromebooks, enterprise settings), unsupported browsers, or Meet opened as an installed app window. In that case the extension shows <i>“Meet audio capture is unavailable in this browser configuration.”</i></li>
              </ul>
            </div>
            <div className="panel">
              <h2>Can&apos;t use the extension?</h2>
              <div className="row">
                <Link className="btn" href="/meetings/new?mode=offline">Use Microphone Mode</Link>
                <Link className="btn" href="/meetings/new?mode=upload">Upload Meeting Recording</Link>
              </div>
              <p className="small muted">Microphone mode picks up what your microphone hears (use speakers, not headphones, if you want remote participants captured). Upload works with a recording exported from Meet.</p>
            </div>
          </div>
        );
      }}
    </AppShell>
  );
}
