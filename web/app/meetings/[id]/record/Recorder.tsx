'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ConsentModal from '@/components/ConsentModal';
import LiveNotes from '@/components/LiveNotes';
import { SegmentRecorder } from '@/lib/client/segment-recorder';
import { UploadQueue, QueueState, idbAll, discardQueued, metaSet } from '@/lib/client/upload-queue';
import { BrowserSpeech, browserSpeechSupported } from '@/lib/client/browser-speech';
import { takePendingStream, describeMediaError } from '@/lib/client/pending-stream';
import { fmtTimer, clock } from '@/lib/format';

type Meeting = {
  id: string; title: string; mode: string; status: string; start_time: string | null; duration_seconds: number;
  timezone: string; transcription_provider: string | null; speaker_map: Record<string, string>; meeting_type: string;
};
type Seg = { seq: number; offset_ms: number; speaker: string | null; text: string; confidence: number | null };
type Phase = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'processing' | 'done';

const SEGMENT_MS = 20_000;
function segmentMs() {
  // Debug/test override: localStorage.mt_segment_ms (min 2 s).
  try {
    const v = Number(localStorage.getItem('mt_segment_ms'));
    if (v >= 2000) return v;
  } catch {}
  return SEGMENT_MS;
}
function silenceThreshold() {
  // Test override: localStorage.mt_silence_threshold ("0" disables silence skipping).
  try {
    const v = localStorage.getItem('mt_silence_threshold');
    if (v !== null && Number.isFinite(Number(v))) return Number(v);
  } catch {}
  return 0.003;
}

export default function Recorder({ meeting }: { meeting: Meeting }) {
  const router = useRouter();
  const sp = useSearchParams();
  const isMeet = meeting.mode === 'meet';
  const browserMode = meeting.transcription_provider === 'browser';

  const [phase, setPhase] = useState<Phase>(
    meeting.status === 'PROCESSING' ? 'processing' : meeting.status === 'COMPLETED' || meeting.status === 'FAILED' ? 'done' : 'idle',
  );
  const [serverStatus, setServerStatus] = useState(meeting.status);
  const [transcriptionStatus, setTranscriptionStatus] = useState('CONNECTING');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [segments, setSegments] = useState<Seg[]>([]);
  const [interim, setInterim] = useState('');
  const [notes, setNotes] = useState<any>(null);
  const [actions, setActions] = useState<any[]>([]);
  const [notesUpdated, setNotesUpdated] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [queueState, setQueueState] = useState<QueueState>({ pending: 0, status: 'CONNECTED', lastError: null, uploaded: 0, persistent: true });
  const [level, setLevel] = useState(0);
  const [activeMs, setActiveMs] = useState(meeting.duration_seconds * 1000);
  const [stuck, setStuck] = useState<number | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [startTime, setStartTime] = useState(meeting.start_time);

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<SegmentRecorder | null>(null);
  const queueRef = useRef<UploadQueue | null>(null);
  const speechRef = useRef<BrowserSpeech | null>(null);
  const cursorRef = useRef(-1);
  const baseActiveRef = useRef(meeting.duration_seconds * 1000);
  const resumedAtRef = useRef<number | null>(null);
  const startWallRef = useRef<number>(meeting.start_time ? new Date(meeting.start_time).getTime() : Date.now());
  const nextSeqRef = useRef(0);
  const textQueueRef = useRef<{ seq: number; offsetMs: number; text: string; confidence: number | null }[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  const elapsed = () => baseActiveRef.current + (resumedAtRef.current ? Date.now() - resumedAtRef.current : 0);

  const post = useCallback(
    (action: string, extra: Record<string, unknown> = {}) =>
      fetch(`/api/meetings/${meeting.id}/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) }).then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b.error || `Request failed (${r.status})`);
        return b;
      }),
    [meeting.id],
  );

  // ---- Upload queue (created once; also drains audio left over from a crash) ----
  useEffect(() => {
    const q = new UploadQueue(
      meeting.id,
      (item) => {
        const fd = new FormData();
        fd.append('audio', item.blob, `seg-${item.seq}`);
        fd.append('seq', String(item.seq));
        fd.append('startMs', String(item.startMs));
        fd.append('durationMs', String(item.durationMs));
        fd.append('silent', item.silent ? '1' : '0');
        return fetch(`/api/meetings/${meeting.id}/segments`, { method: 'POST', body: fd });
      },
      setQueueState,
    );
    queueRef.current = q;
    q.kick();
    return () => q.dispose();
  }, [meeting.id]);

  // ---- Poll server for transcript + notes ----
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`/api/meetings/${meeting.id}/live?after=${cursorRef.current}`);
        if (!r.ok) return;
        const b = await r.json();
        if (!alive) return;
        if (b.segments.length) {
          cursorRef.current = b.segments[b.segments.length - 1].seq;
          setSegments((prev) => {
            const seen = new Set(prev.map((s) => s.seq));
            return [...prev, ...b.segments.filter((s: Seg) => !seen.has(s.seq))];
          });
        }
        setNotes(b.notes);
        setActions(b.actions);
        setNotesUpdated(b.meeting.notes_updated_at);
        setServerStatus(b.meeting.status);
        setTranscriptionStatus(b.meeting.transcription_status);
        setServerError(b.meeting.error);
        if (b.meeting.start_time) setStartTime(b.meeting.start_time);
        nextSeqRef.current = Math.max(nextSeqRef.current, (b.chunks?.max_seq ?? -1) + 1);
        if (isMeet) setActiveMs(b.meeting.duration_seconds * 1000);
        if (b.meeting.status === 'COMPLETED' && (phase === 'processing' || phase === 'stopping')) {
          await metaSet('active', undefined);
          router.push(`/meetings/${meeting.id}`);
        }
      } catch {
        /* offline; the queue shows connection state */
      }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [meeting.id, phase, isMeet, router]);

  // ---- Timer ----
  useEffect(() => {
    if (phase !== 'recording') return;
    const t = setInterval(() => setActiveMs(elapsed()), 500);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => endRef.current?.scrollIntoView({ block: 'nearest' }), [segments.length]);

  // ---- Warn before leaving while recording ----
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (phase === 'recording' || phase === 'paused' || queueState.pending > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [phase, queueState.pending]);

  // ---- Browser speech text flushing ----
  useEffect(() => {
    if (!browserMode) return;
    const t = setInterval(async () => {
      const items = textQueueRef.current.splice(0);
      if (!items.length) return;
      try {
        const r = await fetch(`/api/meetings/${meeting.id}/transcript`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
        if (!r.ok && r.status >= 500) textQueueRef.current.unshift(...items);
      } catch {
        textQueueRef.current.unshift(...items);
      }
    }, 2000);
    return () => clearInterval(t);
  }, [browserMode, meeting.id]);

  // ---- Recovery info ----
  useEffect(() => {
    if (sp.get('recover') === '1') setRecovering(true);
  }, [sp]);

  // ---- Auto-start after the new-meeting page obtained the mic ----
  useEffect(() => {
    if (isMeet || phase !== 'idle') return;
    const s = sp.get('autostart') === '1' ? takePendingStream(meeting.id) : null;
    if (s) {
      window.history.replaceState(null, '', `/meetings/${meeting.id}/record`);
      void begin(s);
    } else if (meeting.status === 'RECORDING' || meeting.status === 'PAUSED') {
      // Reloaded / reopened while the server still thinks we are recording.
      setRecovering(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function attachSpeech() {
    if (!browserMode) return;
    if (!browserSpeechSupported()) {
      setWarning('Browser speech recognition is not available here, so no transcript will be produced. Audio is still saved if audio storage is on.');
      return;
    }
    const sp = new BrowserSpeech(
      (text, confidence) => {
        const offsetMs = Math.max(0, Date.now() - startWallRef.current - 1500);
        const item = { seq: offsetMs, offsetMs, text, confidence };
        textQueueRef.current.push(item);
        // Shown as interim until the server confirms it on the next poll.
        setInterim(text);
      },
      setInterim,
      (msg) => setWarning(msg),
      navigator.language || 'en-IN',
    );
    sp.start();
    speechRef.current = sp;
  }

  async function begin(stream: MediaStream) {
    setError('');
    setPhase('starting');
    streamRef.current = stream;
    try {
      const r = serverStatus === 'NOT_STARTED' ? await post('start') : serverStatus === 'PAUSED' ? await post('resume', { durationSeconds: Math.round(elapsed() / 1000) }) : null;
      if (r?.meeting?.start_time) {
        startWallRef.current = new Date(r.meeting.start_time).getTime();
        setStartTime(r.meeting.start_time);
      }
      setServerStatus('RECORDING');
    } catch (e: any) {
      stream.getTracks().forEach((t) => t.stop());
      setPhase('idle');
      setError(e.message);
      return;
    }
    await metaSet('active', { meetingId: meeting.id });
    const queued = await idbAll(meeting.id).catch(() => []);
    nextSeqRef.current = Math.max(nextSeqRef.current, ...queued.map((q) => q.seq + 1), 0);
    // Uploading audio is only needed for server transcription or for retention.
    const rec = new SegmentRecorder(stream, {
      segmentMs: segmentMs(),
      silenceThreshold: silenceThreshold(),
      meetingStartWall: startWallRef.current,
      nextSeq: nextSeqRef.current,
      onLevel: setLevel,
      onSegment: (blob, meta) => {
        nextSeqRef.current = meta.seq + 1;
        void queueRef.current?.add({ seq: meta.seq, blob, startMs: Math.max(0, meta.startMs), durationMs: meta.durationMs, silent: meta.silent, mime: meta.mime });
      },
    });
    for (const track of stream.getAudioTracks()) {
      track.onended = () => {
        setWarning('The microphone stopped (device disconnected or permission revoked). Recording is paused; reconnect and resume.');
        void pause();
      };
    }
    rec.start();
    recRef.current = rec;
    resumedAtRef.current = Date.now();
    attachSpeech();
    setPhase('recording');
    setRecovering(false);
  }

  async function requestMicAndBegin() {
    setConsent(false);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      await begin(s);
    } catch (e) {
      setError(describeMediaError(e));
    }
  }

  async function pause() {
    if (!recRef.current) return;
    baseActiveRef.current = elapsed();
    resumedAtRef.current = null;
    setActiveMs(baseActiveRef.current);
    speechRef.current?.stop();
    await recRef.current.stop();
    setPhase('paused');
    try {
      await post('pause', { durationSeconds: Math.round(baseActiveRef.current / 1000) });
      setServerStatus('PAUSED');
    } catch (e: any) {
      setWarning(`Paused locally; server not reachable yet (${e.message}).`);
    }
  }

  async function resume() {
    const s = streamRef.current;
    if (!s || s.getAudioTracks().every((t) => t.readyState === 'ended')) {
      // Microphone was lost; ask again.
      try {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
        recRef.current?.dispose();
        recRef.current = null;
        setServerStatus('PAUSED');
        await begin(streamRef.current);
        return;
      } catch (e) {
        setError(describeMediaError(e));
        return;
      }
    }
    try {
      await post('resume', { durationSeconds: Math.round(baseActiveRef.current / 1000) });
      setServerStatus('RECORDING');
    } catch (e: any) {
      setWarning(`Resumed locally; server not reachable yet (${e.message}).`);
    }
    resumedAtRef.current = Date.now();
    recRef.current!.resume();
    attachSpeech();
    setPhase('recording');
  }

  async function stop(force = false) {
    setPhase('stopping');
    if (resumedAtRef.current) {
      baseActiveRef.current = elapsed();
      resumedAtRef.current = null;
    }
    setActiveMs(baseActiveRef.current);
    speechRef.current?.stop();
    await recRef.current?.stop();
    recRef.current?.dispose();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (!force) {
      const left = await queueRef.current!.flush(45_000);
      if (left) {
        setStuck(left);
        return;
      }
    }
    // Flush any browser-speech text still waiting.
    if (textQueueRef.current.length) {
      await fetch(`/api/meetings/${meeting.id}/transcript`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: textQueueRef.current.splice(0) }) }).catch(() => {});
    }
    setStuck(null);
    try {
      await post('stop', { durationSeconds: Math.round(baseActiveRef.current / 1000) });
      setPhase('processing');
    } catch (e: any) {
      setError(`Could not finish the meeting: ${e.message}. Your transcript is saved; try Stop again.`);
      setPhase('paused');
    }
  }

  async function discard() {
    if (!confirm('Discard this meeting and delete everything captured so far?')) return;
    await discardQueued(meeting.id).catch(() => {});
    await metaSet('active', undefined);
    await fetch(`/api/meetings/${meeting.id}`, { method: 'DELETE' });
    router.push('/');
  }

  const recording = phase === 'recording';
  const paused = phase === 'paused';
  const linkBadge = queueState.status === 'CONNECTED' ? 'ok' : queueState.status === 'BUFFERING' ? 'warn' : 'err';
  const tsBadge = transcriptionStatus === 'FAILED' ? 'err' : transcriptionStatus === 'TRANSCRIBING' ? 'ok' : 'warn';

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1 style={{ marginBottom: 2 }}>{meeting.title}</h1>
          <div className="muted small">{meeting.meeting_type} · {isMeet ? 'Google Meet (captured by the Chrome extension)' : meeting.mode === 'upload' ? 'Uploaded recording' : 'Offline meeting (microphone)'}</div>
        </div>
        <div className="row">
          {recording && <span className="rec" data-testid="recording-indicator"><span className="pulse" /> ● Recording</span>}
          {paused && <span className="rec paused" data-testid="paused-indicator"><span className="pulse" /> Paused</span>}
          {isMeet && serverStatus === 'RECORDING' && <span className="rec"><span className="pulse" /> ● Recording in extension</span>}
        </div>
      </div>

      {error && <div className="alert err" data-testid="recorder-error">{error} {error.includes('icrophone') && <><a href="/meetings/new?mode=upload">Upload a recording instead</a>.</>}</div>}
      {warning && <div className="alert warn">{warning}</div>}
      {serverError && <div className="alert warn small" data-testid="server-error">{serverError}</div>}
      {recovering && (
        <div className="alert warn" data-testid="recover-panel">
          <b>This meeting was interrupted.</b> Everything uploaded before the interruption is saved{queueState.pending ? `, and ${queueState.pending} audio segment(s) from this browser are being uploaded now` : ''}.
          <div className="row" style={{ marginTop: 8 }}>
            {!isMeet && <button className="btn" onClick={() => { setRecovering(false); setConsent(true); }}>Continue recording</button>}
            <button className="btn primary" onClick={() => { setRecovering(false); void stop(); }}>Finish &amp; generate notes</button>
            <button className="btn danger" onClick={discard}>Discard meeting</button>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="spread">
          <div>
            <div className="timer" data-testid="timer">{fmtTimer(activeMs)}</div>
            <div className="row small">
              <span>Audio: <span className={`badge ${linkBadge}`} data-testid="audio-status">{queueState.status}</span></span>
              {queueState.pending > 0 && <span className="muted">{queueState.pending} segment(s) buffered{queueState.persistent ? ' on this device' : ' in memory'}</span>}
              <span>Transcription: <span className={`badge ${tsBadge}`} data-testid="transcription-status">{browserMode && recording ? 'TRANSCRIBING' : transcriptionStatus}</span></span>
              {recording && <span className="meter" title="Input level"><div style={{ width: `${Math.round(level * 100)}%` }} /></span>}
            </div>
            {queueState.lastError && <div className="small" style={{ color: 'var(--warn)', marginTop: 4 }}>{queueState.lastError}</div>}
          </div>
          {!isMeet && (
            <div className="row">
              {phase === 'idle' && !recovering && (
                <button className="btn primary" onClick={() => setConsent(true)} data-testid="start-recording">Start recording</button>
              )}
              {recording && <button className="btn" onClick={pause} data-testid="pause">Pause</button>}
              {paused && <button className="btn primary" onClick={resume} data-testid="resume">Resume</button>}
              {(recording || paused) && <button className="btn danger" onClick={() => stop()} data-testid="stop">Stop Meeting</button>}
              {phase === 'starting' && <span className="muted">Starting…</span>}
            </div>
          )}
          {isMeet && serverStatus !== 'COMPLETED' && serverStatus !== 'PROCESSING' && (
            <div className="small muted" style={{ maxWidth: 280 }}>Recording is controlled from the Meeting AI extension popup in the Google Meet tab.</div>
          )}
        </div>
        {phase === 'stopping' && !stuck && <div className="alert" style={{ marginTop: 12 }}>Finishing uploads…</div>}
        {stuck !== null && (
          <div className="alert warn" style={{ marginTop: 12 }}>
            {stuck} audio segment(s) have not uploaded yet (connection problem). They are kept in this browser.
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => stop()}>Keep waiting</button>
              <button className="btn danger" onClick={() => stop(true)}>Finish without them</button>
            </div>
          </div>
        )}
        {(phase === 'processing' || serverStatus === 'PROCESSING') && <div className="alert info" style={{ marginTop: 12 }} data-testid="processing">Generating final meeting notes…</div>}
        {phase === 'done' && <div className="alert ok" style={{ marginTop: 12 }}>This meeting has ended. <a href={`/meetings/${meeting.id}`}>Open meeting notes</a></div>}
      </div>

      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="panel">
          <h2>Live Transcript</h2>
          <div className="transcript" data-testid="live-transcript">
            {segments.length === 0 && !interim && <p className="muted">{recording ? 'Listening… the first lines appear after about 20 seconds.' : 'No transcript yet.'}</p>}
            {segments.map((s) => (
              <div className="seg" key={s.seq}>
                <div className="meta">[{clock(startTime, s.offset_ms, meeting.timezone)}]</div>
                <span className="spk">{(s.speaker && meeting.speaker_map?.[s.speaker]) || s.speaker || 'Unknown Speaker'}:</span> {s.text}
              </div>
            ))}
            {interim && <div className="seg muted"><i>{interim}</i></div>}
            <div ref={endRef} />
          </div>
        </div>
        <div className="panel">
          <div className="spread">
            <h2>Live Notes</h2>
            <button className="btn sm" onClick={() => fetch(`/api/meetings/${meeting.id}/notes`, { method: 'POST' })} disabled={!segments.length}>Update now</button>
          </div>
          <LiveNotes notes={notes} actions={actions} updatedAt={notesUpdated} />
        </div>
      </div>

      {consent && <ConsentModal onCancel={() => setConsent(false)} onAccept={requestMicAndBegin} />}
    </div>
  );
}
