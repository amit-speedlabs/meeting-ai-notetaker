'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConsentModal from '@/components/ConsentModal';
import { setPendingStream, describeMediaError } from '@/lib/client/pending-stream';
import { browserSpeechSupported } from '@/lib/client/browser-speech';
import { fileToWavChunks } from '@/lib/client/wav';
import { UploadQueue } from '@/lib/client/upload-queue';

type P = { name: string; email: string; organisation: string };
type Server = { id: string; label: string; ready: boolean; isDemo: boolean; thirdParty: boolean };

export default function NewMeetingForm({ mode, types, server, storeAudio, retentionDays }: { mode: 'offline' | 'upload'; types: string[]; server: Server; storeAudio: boolean; retentionDays: number | null }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [type, setType] = useState('Internal Meeting');
  const [people, setPeople] = useState<P[]>([]);
  const [engine, setEngineState] = useState<'server' | 'browser'>('server');
  const touched = useRef(false);
  const setEngine = (v: 'server' | 'browser') => {
    touched.current = true;
    setEngineState(v);
  };
  const [speechOk, setSpeechOk] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');

  useEffect(() => {
    const ok = browserSpeechSupported();
    setSpeechOk(ok);
    // Prefer real (browser) transcription over demo text, unless the user already chose.
    if (mode === 'offline' && ok && (server.isDemo || !server.ready) && !touched.current) setEngineState('browser');
  }, [mode, server.isDemo, server.ready]);

  async function createMeeting() {
    const res = await fetch('/api/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        meetingType: type,
        mode,
        consent: true,
        transcription: mode === 'offline' ? engine : 'server',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        participants: people.filter((p) => p.name.trim()),
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not create meeting');
    return body.meeting.id as string;
  }

  async function startOffline() {
    setBusy(true);
    setError('');
    let stream: MediaStream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('unsupported'), { name: 'Unsupported' });
      // Browser shows: "<site> wants to use your microphone".
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      setConsent(false);
      setBusy(false);
      setError(describeMediaError(e));
      return;
    }
    try {
      const id = await createMeeting();
      setPendingStream(id, stream);
      router.push(`/meetings/${id}/record?autostart=1`);
    } catch (e: any) {
      stream.getTracks().forEach((t) => t.stop());
      setConsent(false);
      setBusy(false);
      setError(e.message);
    }
  }

  async function startUpload() {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      setProgress('Decoding audio in your browser…');
      const chunks = await fileToWavChunks(file, 60, (p) => setProgress(`Preparing audio… ${Math.round(p * 100)}%`));
      const id = await createMeeting();
      await fetch(`/api/meetings/${id}/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start' }) });
      let done = 0;
      const queue = new UploadQueue(
        id,
        (item) => {
          const fd = new FormData();
          fd.append('audio', item.blob, `chunk-${item.seq}.wav`);
          fd.append('seq', String(item.seq));
          fd.append('startMs', String(item.startMs));
          fd.append('durationMs', String(item.durationMs));
          fd.append('silent', item.silent ? '1' : '0');
          return fetch(`/api/meetings/${id}/segments`, { method: 'POST', body: fd });
        },
        (s) => s.lastError && setProgress(`Transcribing… ${s.lastError}`),
        () => setProgress(`Transcribing… ${++done}/${chunks.length} segments`),
      );
      for (let i = 0; i < chunks.length; i++) await queue.add({ seq: i, blob: chunks[i].blob, startMs: chunks[i].startMs, durationMs: chunks[i].durationMs, silent: chunks[i].silent, mime: 'audio/wav' });
      const left = await queue.flush(30 * 60_000);
      queue.dispose();
      if (left) throw new Error(`${left} segment(s) could not be transcribed. You can retry from the dashboard.`);
      const total = Math.round((chunks.at(-1)!.startMs + chunks.at(-1)!.durationMs) / 1000);
      await fetch(`/api/meetings/${id}/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stop', durationSeconds: total }) });
      router.push(`/meetings/${id}`);
    } catch (e: any) {
      setConsent(false);
      setBusy(false);
      setProgress('');
      setError(e.message || String(e));
    }
  }

  const where =
    engine === 'browser'
      ? "Transcription: your browser's speech recognition (Chrome sends the audio to Google's speech service)."
      : server.isDemo
        ? 'Transcription: DEMO mode — audio is not transcribed; a sample conversation is inserted.'
        : `Transcription: ${server.label}${server.thirdParty ? ' (audio is sent to this third-party provider)' : ''}.`;
  const retention = storeAudio ? `Audio is stored on this server${retentionDays ? ` for ${retentionDays} day(s)` : ' until you delete it'}.` : 'Audio is not stored after transcription.';

  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return setError('Please enter a meeting title');
        if (mode === 'upload' && !file) return setError('Choose a recording to upload');
        setError('');
        setConsent(true);
      }}
    >
      <div className="field">
        <label htmlFor="title">Meeting Title</label>
        <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="AI Olympiad Weekly Review" required maxLength={200} />
      </div>
      <div className="field">
        <label htmlFor="type">Meeting Type</label>
        <select id="type" value={type} onChange={(e) => setType(e.target.value)}>
          {types.map((t) => <option key={t}>{t}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Participants <span className="muted small">(optional)</span></label>
        {people.map((p, i) => (
          <div className="row" key={i} style={{ marginBottom: 6, flexWrap: 'nowrap' }}>
            {(['name', 'email', 'organisation'] as const).map((k) => (
              <input key={k} placeholder={k[0].toUpperCase() + k.slice(1)} value={p[k]} aria-label={`Participant ${i + 1} ${k}`}
                onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />
            ))}
            <button type="button" className="btn ghost sm" onClick={() => setPeople(people.filter((_, j) => j !== i))} aria-label="Remove participant">✕</button>
          </div>
        ))}
        <button type="button" className="btn sm" onClick={() => setPeople([...people, { name: '', email: '', organisation: '' }])}>+ Add participant</button>
      </div>

      {mode === 'offline' && (
        <div className="field">
          <label>Transcription</label>
          <label style={{ fontWeight: 400 }}>
            <input type="radio" style={{ width: 'auto' }} checked={engine === 'server'} onChange={() => setEngine('server')} disabled={!server.ready} />{' '}
            Server: {server.label}
            {!server.ready && <span className="badge err" style={{ marginLeft: 6 }}>not configured</span>}
          </label>
          <label style={{ fontWeight: 400 }}>
            <input type="radio" style={{ width: 'auto' }} checked={engine === 'browser'} onChange={() => setEngine('browser')} disabled={!speechOk} /> Browser speech recognition{' '}
            {!speechOk && <span className="badge gray">not supported in this browser</span>}
            <div className="small muted" style={{ marginLeft: 22 }}>Real transcription without an API key (Chrome). No speaker labels. Chrome sends audio to Google to transcribe it.</div>
          </label>
        </div>
      )}

      {mode === 'upload' && (
        <div className="field">
          <label htmlFor="file">Recording file</label>
          <input id="file" type="file" accept="audio/*,video/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <div className="small muted">Decoded in your browser and uploaded in 60-second segments. Large files need enough memory to decode.</div>
        </div>
      )}

      <div className="alert info small" style={{ marginBottom: 14 }}>
        <div>{mode === 'offline' ? 'What is captured: audio from the microphone you allow, only while the recording indicator is shown.' : 'What is processed: the file you choose.'}</div>
        <div>{where}</div>
        <div>{retention} <a href="/settings">Change</a></div>
      </div>

      {error && <div className="alert err" style={{ marginBottom: 12 }} data-testid="form-error">{error}{mode === 'offline' && error.includes('icrophone') && <> You can also <a href="/meetings/new?mode=upload">upload a recording</a> instead.</>}</div>}
      {progress && <div className="alert" style={{ marginBottom: 12 }}>{progress}</div>}
      <button className="btn primary" disabled={busy} data-testid="start-button">
        {mode === 'upload' ? 'Upload & Transcribe' : 'Start Offline Meeting'}
      </button>
      {consent && <ConsentModal busy={busy} onCancel={() => setConsent(false)} onAccept={mode === 'upload' ? startUpload : startOffline} details={<>{where} {retention}</>} />}
    </form>
  );
}
