'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { fmtDay, fmtDuration, STATUS_BADGE, statusLabel } from '@/lib/format';
import TranscriptTab from './TranscriptTab';
import ActionsTab from './ActionsTab';
import AudioTab from './AudioTab';

const TABS = [
  ['overview', 'Overview'], ['transcript', 'Transcript'], ['notes', 'Notes'], ['actions', 'Action Items'],
  ['decisions', 'Decisions'], ['participants', 'Participants'], ['audio', 'Audio'], ['activity', 'Activity'],
] as const;

export default function MeetingDetail({ id, initialTab, jumpSeq, types }: { id: string; initialTab: string; jumpSeq: number | null; types: string[] }) {
  const router = useRouter();
  const [tab, setTab] = useState(initialTab);
  const [data, setData] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [seq, setSeq] = useState<number | null>(jumpSeq);

  const load = useCallback(async () => {
    const r = await fetch(`/api/meetings/${id}`);
    if (r.ok) setData(await r.json());
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);
  // While final notes are being generated, keep refreshing.
  useEffect(() => {
    if (data?.meeting?.status !== 'PROCESSING') return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [data?.meeting?.status, load]);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(''), 4000);
  };
  const copy = async (format: 'copy' | 'copy-actions') => {
    const r = await fetch(`/api/meetings/${id}/export?format=${format}`);
    const { text } = await r.json();
    try {
      await navigator.clipboard.writeText(text);
      flash(format === 'copy' ? 'Notes copied to clipboard' : 'Action items copied to clipboard');
    } catch {
      flash('Clipboard not available in this browser');
    }
  };
  const share = async () => {
    const r = await fetch(`/api/meetings/${id}/share`, { method: 'POST' });
    const { url } = await r.json();
    try {
      await navigator.clipboard.writeText(url);
      flash(`Share link copied: ${url}`);
    } catch {
      flash(`Share link: ${url}`);
    }
    load();
  };
  const regenerate = async () => {
    setBusy(true);
    const r = await fetch(`/api/meetings/${id}/notes`, { method: 'POST' });
    const b = await r.json().catch(() => ({}));
    setBusy(false);
    flash(r.ok && !b.error ? 'Notes regenerated' : `Could not regenerate notes: ${b.error || r.status}`);
    load();
  };
  const del = async () => {
    if (!confirm('Delete this meeting, its transcript, notes, action items and audio? This cannot be undone.')) return;
    await fetch(`/api/meetings/${id}`, { method: 'DELETE' });
    router.push('/meetings');
  };

  if (!data) return <p className="muted">Loading…</p>;
  const { meeting: m, notes, participants, actions, activity, audio, speakers } = data;
  const live = m.status === 'RECORDING' || m.status === 'PAUSED' || m.status === 'NOT_STARTED';

  return (
    <div>
      <div className="spread" style={{ marginBottom: 12 }}>
        <div>
          <EditableTitle id={id} title={m.title} onSaved={load} />
          <div className="muted small row">
            <TypeSelect id={id} value={m.meeting_type} types={types} onSaved={load} />
            <span>· {fmtDay(m.start_time || m.created_at, m.timezone)}</span>
            <span>· {fmtDuration(m.duration_seconds)}</span>
            <span>· {m.mode === 'meet' ? 'Google Meet' : m.mode === 'upload' ? 'Uploaded recording' : 'Offline'}</span>
            <span className={`badge ${STATUS_BADGE[m.status]}`} data-testid="meeting-status">{statusLabel(m.status)}</span>
            {m.is_demo && <span className="demo-tag">DEMO DATA</span>}
          </div>
        </div>
        <div className="row">
          {live && <Link className="btn primary" href={`/meetings/${id}/record`}>Open live view</Link>}
          <details style={{ position: 'relative' }}>
            <summary className="btn" style={{ listStyle: 'none' }}>Export ▾</summary>
            <div className="panel" style={{ position: 'absolute', right: 0, zIndex: 5, padding: 8, minWidth: 200 }}>
              {[['pdf', 'PDF'], ['docx', 'Word (DOCX)'], ['md', 'Markdown'], ['txt', 'Text']].map(([f, l]) => (
                <a key={f} className="btn ghost sm" style={{ width: '100%' }} href={`/api/meetings/${id}/export?format=${f}`} data-testid={`export-${f}`}>{l}</a>
              ))}
              <a className="btn ghost sm" style={{ width: '100%' }} href={`/api/meetings/${id}/export?format=md&transcript=1`}>Markdown + transcript</a>
            </div>
          </details>
          <button className="btn" onClick={() => copy('copy')}>Copy Notes</button>
          <button className="btn" onClick={() => copy('copy-actions')}>Copy Action Items</button>
          <button className="btn" onClick={share}>Copy link</button>
        </div>
      </div>
      {msg && <div className="alert ok small" style={{ marginBottom: 12 }} data-testid="flash">{msg}</div>}
      {m.status === 'PROCESSING' && <div className="alert info" style={{ marginBottom: 12 }}>Generating final meeting notes…</div>}
      {m.error && <div className="alert warn small" style={{ marginBottom: 12 }}>{m.error}</div>}
      {m.is_demo && <div className="alert warn small" style={{ marginBottom: 12 }}>This is demo data created to show how the app works. It is not a real meeting.</div>}

      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" className={tab === k ? 'active' : ''} onClick={() => setTab(k)} data-testid={`tab-${k}`}>
            {l}{k === 'actions' ? ` (${actions.filter((a: any) => a.status !== 'cancelled').length})` : ''}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid2" style={{ alignItems: 'start' }}>
          <div className="panel">
            <h2>Executive Summary</h2>
            <p data-testid="summary">{notes?.summary || <span className="muted">No summary yet.</span>}</p>
            <h3>Key Discussion Points</h3>
            <Bullets xs={notes?.key_points} />
            <h3>Decisions Made</h3>
            <Bullets xs={notes?.decisions} />
            <h3>Next Steps</h3>
            <Bullets xs={notes?.next_steps} />
          </div>
          <div className="stack">
            <div className="panel">
              <h2>Action Items</h2>
              <ActionsTab meetingId={id} actions={actions} onChange={load} compact />
            </div>
            <div className="panel">
              <h2>Important Numbers</h2>
              <Bullets xs={notes?.important_numbers} />
              <h3>Open Questions</h3>
              <Bullets xs={notes?.open_questions} />
            </div>
            <div className="panel">
              <h2>Details</h2>
              <div className="small">Participants: {participants.map((p: any) => p.name).join(', ') || speakers.map((s: any) => m.speaker_map?.[s.speaker] || s.speaker || 'Unknown Speaker').join(', ') || '—'}</div>
              <div className="small">Transcription: {m.transcription_provider || '—'} · Notes: {notes?.provider || m.llm_provider || '—'}{notes && !notes.is_final ? ' (live, not final)' : ''}</div>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn sm" onClick={regenerate} disabled={busy || live || m.status === 'PROCESSING'}>{busy ? 'Regenerating…' : 'Regenerate notes'}</button>
                <button className="btn sm danger" onClick={del}>Delete meeting</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'transcript' && <TranscriptTab meeting={m} speakers={speakers} jumpSeq={seq} onSpeakersSaved={load} />}

      {tab === 'notes' && (
        <div className="panel">
          <h2>Summary</h2>
          <p>{notes?.summary || '—'}</p>
          {[
            ['Key Discussion Points', notes?.key_points], ['Decisions', notes?.decisions], ['Questions / Open Issues', notes?.open_questions],
            ['Risks / Blockers', notes?.risks], ['Follow-ups', notes?.follow_ups], ['Important Numbers', notes?.important_numbers],
            ['Topics Discussed', notes?.topics], ['Next Steps', notes?.next_steps],
          ].map(([t, xs]) => (
            <div key={t as string}>
              <h3>{t as string}</h3>
              <Bullets xs={xs as string[]} />
            </div>
          ))}
        </div>
      )}

      {tab === 'actions' && (
        <div className="panel">
          <ActionsTab meetingId={id} actions={actions} onChange={load} />
        </div>
      )}

      {tab === 'decisions' && (
        <div className="panel" data-testid="decisions">
          <h2>Decisions</h2>
          <Bullets xs={notes?.decisions} />
        </div>
      )}

      {tab === 'participants' && <ParticipantsTab id={id} participants={participants} speakers={speakers} speakerMap={m.speaker_map} onSaved={load} />}

      {tab === 'audio' && <AudioTab meeting={m} audio={audio} onChange={load} onJump={(s) => { setSeq(s); setTab('transcript'); }} />}

      {tab === 'activity' && (
        <div className="panel">
          <h2>Activity</h2>
          <table>
            <tbody>
              {activity.map((a: any, i: number) => (
                <tr key={i}>
                  <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{new Date(a.created_at).toLocaleString()}</td>
                  <td>{a.user_name || 'System'}</td>
                  <td>{a.kind.replace(/_/g, ' ')}</td>
                  <td className="small muted">{describe(a)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function describe(a: any) {
  const d = a.detail || {};
  if (d.task) return d.task + (d.changes ? ` — ${Object.entries(d.changes).map(([k, v]: any) => `${k}: ${v[0] ?? '—'} → ${v[1] ?? '—'}`).join(', ')}` : '');
  if (d.from || d.to) return `${d.from} → ${d.to}`;
  if (d.map) return Object.entries(d.map).map(([k, v]) => `${k} → ${v}`).join(', ');
  if (d.format) return d.format;
  if (d.reason) return d.reason;
  if (d.mode) return `mode: ${d.mode}, consent confirmed`;
  return '';
}

function Bullets({ xs }: { xs?: string[] }) {
  if (!xs || !xs.length) return <div className="muted small">None</div>;
  return <ul className="clean">{xs.map((x, i) => <li key={i}>{x}</li>)}</ul>;
}

function EditableTitle({ id, title, onSaved }: { id: string; title: string; onSaved: () => void }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(title);
  if (!edit) return <h1 style={{ marginBottom: 4, cursor: 'text' }} title="Click to rename" onClick={() => setEdit(true)}>{title}</h1>;
  return (
    <form className="row" style={{ marginBottom: 8 }} onSubmit={async (e) => {
      e.preventDefault();
      await fetch(`/api/meetings/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: v }) });
      setEdit(false);
      onSaved();
    }}>
      <input value={v} onChange={(e) => setV(e.target.value)} style={{ fontSize: 18, width: 420 }} autoFocus />
      <button className="btn sm primary">Save</button>
      <button type="button" className="btn sm" onClick={() => setEdit(false)}>Cancel</button>
    </form>
  );
}

function TypeSelect({ id, value, types, onSaved }: { id: string; value: string; types: string[]; onSaved: () => void }) {
  return (
    <select value={value} style={{ width: 'auto', padding: '2px 6px', fontSize: 12 }} onChange={async (e) => {
      await fetch(`/api/meetings/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingType: e.target.value }) });
      onSaved();
    }}>
      {types.map((t) => <option key={t}>{t}</option>)}
    </select>
  );
}

function ParticipantsTab({ id, participants, speakers, speakerMap, onSaved }: any) {
  const [list, setList] = useState(participants.map((p: any) => ({ name: p.name, email: p.email || '', organisation: p.organisation || '' })));
  const [saved, setSaved] = useState('');
  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <div className="panel">
        <h2>Participants</h2>
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Organisation</th><th /></tr></thead>
          <tbody>
            {list.map((p: any, i: number) => (
              <tr key={i}>
                {(['name', 'email', 'organisation'] as const).map((k) => (
                  <td key={k}><input value={p[k]} onChange={(e) => setList(list.map((x: any, j: number) => (j === i ? { ...x, [k]: e.target.value } : x)))} /></td>
                ))}
                <td><button className="btn ghost sm" onClick={() => setList(list.filter((_: any, j: number) => j !== i))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn sm" onClick={() => setList([...list, { name: '', email: '', organisation: '' }])}>+ Add</button>
          <button className="btn sm primary" onClick={async () => {
            await fetch(`/api/meetings/${id}/participants`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ participants: list.filter((p: any) => p.name.trim()) }) });
            setSaved('Saved');
            onSaved();
          }}>Save participants</button>
          <span className="small muted">{saved}</span>
        </div>
      </div>
      <div className="panel">
        <h2>Speakers in transcript</h2>
        <p className="small muted">Speaker labels come from the transcription service and are never matched to people automatically. Rename them in the Transcript tab.</p>
        <ul className="clean">{speakers.map((s: any) => <li key={s.speaker || 'unknown'}>{s.speaker || 'Unknown Speaker'}{s.speaker && speakerMap?.[s.speaker] ? ` → ${speakerMap[s.speaker]}` : ''} <span className="muted small">({s.n} lines)</span></li>)}</ul>
      </div>
    </div>
  );
}
