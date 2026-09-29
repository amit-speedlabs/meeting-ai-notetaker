'use client';
import { useEffect, useRef, useState } from 'react';
import { fmtTimer } from '@/lib/format';

export default function AudioTab({ meeting, audio, onChange, onJump }: { meeting: any; audio: any; onChange: () => void; onJump: (seq: number) => void }) {
  const [chunks, setChunks] = useState<any[]>([]);
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    fetch(`/api/meetings/${meeting.id}/audio`).then((r) => r.json()).then((b) => setChunks(b.chunks || []));
  }, [meeting.id, audio?.stored]);

  useEffect(() => {
    if (playing) ref.current?.play().catch(() => {});
  }, [idx, playing]);

  const del = async () => {
    if (!confirm('Delete the audio for this meeting? The transcript and notes are kept.')) return;
    await fetch(`/api/meetings/${meeting.id}/audio`, { method: 'DELETE' });
    setChunks([]);
    onChange();
  };

  if (!chunks.length)
    return (
      <div className="panel">
        <h2>Audio</h2>
        <p className="muted" data-testid="no-audio">
          {meeting.store_audio ? 'No audio is stored for this meeting (it was deleted, expired under your retention setting, or never uploaded).' : 'Audio storage was turned off for this meeting, so only the transcript was kept.'}
        </p>
      </div>
    );

  const c = chunks[idx];
  return (
    <div className="panel">
      <div className="spread">
        <h2>Audio</h2>
        <button className="btn danger sm" onClick={del} data-testid="delete-audio">Delete Audio, Keep Transcript</button>
      </div>
      <p className="small muted">{chunks.length} segment(s), {Math.round(Number(audio.bytes) / 1024)} KB stored. Segments play back to back.</p>
      <audio
        ref={ref}
        controls
        src={`/api/meetings/${meeting.id}/audio?chunk=${c.chunk_seq}`}
        onPlay={() => setPlaying(true)}
        onPause={(e) => { if (!(e.target as HTMLAudioElement).ended) setPlaying(false); }}
        onEnded={() => (idx + 1 < chunks.length ? setIdx(idx + 1) : setPlaying(false))}
        style={{ width: '100%' }}
      />
      <div className="small" style={{ marginTop: 6 }}>Segment {idx + 1} of {chunks.length} · starts at {fmtTimer(c.start_ms)}</div>
      <div className="row" style={{ marginTop: 10 }}>
        {chunks.map((ch, i) => (
          <button key={ch.chunk_seq} className={`btn sm ${i === idx ? 'primary' : ''}`} onClick={() => { setIdx(i); setPlaying(true); }}>{fmtTimer(ch.start_ms)}</button>
        ))}
      </div>
      <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => onJump(c.chunk_seq * 1000)}>Show this part in the transcript</button>
    </div>
  );
}
