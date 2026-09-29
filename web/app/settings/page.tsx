import AppShell from '@/components/AppShell';
import SettingsForm from './SettingsForm';
import { transcriptionProviderInfo } from '@/lib/transcription';
import { llmProviderInfo } from '@/lib/llm';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  const t = transcriptionProviderInfo();
  const a = llmProviderInfo();
  return (
    <AppShell>
      {() => (
        <div className="stack" style={{ maxWidth: 820 }}>
          <h1>Settings</h1>
          <SettingsForm appUrl={config.appUrl} />
          <div className="panel">
            <h2>Processing providers</h2>
            <table>
              <tbody>
                <tr><td>Transcription</td><td>{t.label}</td><td>{t.ready ? <span className="badge ok">ready</span> : <span className="badge err">{t.problem}</span>}</td><td className="small muted">{t.isDemo ? 'Demo only — does not transcribe your audio' : t.sendsAudioToThirdParty ? 'Audio segments are sent to this provider' : ''}</td></tr>
                <tr><td>AI notes</td><td>{a.label}</td><td>{a.ready ? <span className="badge ok">ready</span> : <span className="badge err">{a.problem}</span>}</td><td className="small muted">{a.isHeuristic ? 'Runs on this server; no data leaves it' : 'Transcript text is sent to this provider'}</td></tr>
              </tbody>
            </table>
            <p className="small muted">Providers and API keys are configured by the server administrator through environment variables. Keys never reach the browser.</p>
          </div>
        </div>
      )}
    </AppShell>
  );
}
