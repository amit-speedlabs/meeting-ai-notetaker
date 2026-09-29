'use client';
import { useEffect, useState } from 'react';

export default function SettingsForm({ appUrl }: { appUrl: string }) {
  const [store, setStore] = useState(true);
  const [ret, setRet] = useState<string>('null');
  const [msg, setMsg] = useState('');
  const [tokens, setTokens] = useState<any[]>([]);
  const [newToken, setNewToken] = useState('');

  const loadTokens = () => fetch('/api/tokens').then((r) => r.json()).then((b) => setTokens(b.tokens || []));
  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then(({ settings }) => {
      setStore(settings.store_audio);
      setRet(settings.retention_days === null ? 'null' : String(settings.retention_days));
    });
    loadTokens();
  }, []);

  return (
    <>
      <div className="panel">
        <h2>Audio retention</h2>
        <div className="field">
          <label>Store audio</label>
          <label style={{ fontWeight: 400 }}><input type="radio" style={{ width: 'auto' }} checked={store} onChange={() => setStore(true)} /> Yes — keep audio for playback</label>
          <label style={{ fontWeight: 400 }}><input type="radio" style={{ width: 'auto' }} checked={!store} onChange={() => setStore(false)} data-testid="store-audio-no" /> No — transcribe, then discard audio</label>
        </div>
        <div className="field">
          <label htmlFor="ret">Retention</label>
          <select id="ret" value={ret} onChange={(e) => setRet(e.target.value)} disabled={!store} style={{ maxWidth: 240 }}>
            <option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="null">Until manually deleted</option>
          </select>
          <div className="small muted">Applies to new and existing meetings. Transcripts and notes are kept until you delete the meeting. You can delete audio for any meeting from its Audio tab.</div>
        </div>
        <button className="btn primary" onClick={async () => {
          const r = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeAudio: store, retentionDays: ret === 'null' ? null : Number(ret) }) });
          const b = await r.json();
          setMsg(r.ok ? `Saved.${b.purgedMeetings ? ` Removed expired audio from ${b.purgedMeetings} meeting(s).` : ''}` : b.error);
        }}>Save</button> <span className="small muted" data-testid="settings-msg">{msg}</span>
      </div>

      <div className="panel">
        <h2>Chrome extension</h2>
        <p className="small">The Google Meet extension talks to this server with a personal access token. Create one, then paste the server URL and token into the extension&apos;s options page.</p>
        <div className="small">Server URL: <code>{appUrl}</code></div>
        {newToken && (
          <div className="alert ok" style={{ margin: '10px 0' }}>
            Copy this token now; it will not be shown again:
            <div><code data-testid="new-token" style={{ wordBreak: 'break-all' }}>{newToken}</code></div>
          </div>
        )}
        <button className="btn" style={{ marginTop: 10 }} onClick={async () => {
          const r = await fetch('/api/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Chrome extension' }) });
          const b = await r.json();
          setNewToken(b.token);
          loadTokens();
        }}>Create extension token</button>
        {tokens.length > 0 && (
          <table style={{ marginTop: 10 }}>
            <thead><tr><th>Name</th><th>Created</th><th>Last used</th><th /></tr></thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className="small">{new Date(t.created_at).toLocaleString()}</td>
                  <td className="small">{t.last_used_at ? new Date(t.last_used_at).toLocaleString() : 'Never'}</td>
                  <td><button className="btn sm" onClick={async () => { await fetch(`/api/tokens/${t.id}`, { method: 'DELETE' }); loadTokens(); }}>Revoke</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
