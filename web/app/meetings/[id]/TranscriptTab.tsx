'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { clock } from '@/lib/format';

type Seg = { seq: number; offset_ms: number; speaker: string | null; text: string; confidence: number | null; highlight?: string };

function Highlighted({ html }: { html: string }) {
  // ts_headline marks matches with « »; render them as <mark> without using innerHTML.
  const parts = html.split(/(«[^»]*»)/g);
  return <>{parts.map((p, i) => (p.startsWith('«') ? <mark key={i}>{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>))}</>;
}

export default function TranscriptTab({ meeting, speakers, jumpSeq, onSpeakersSaved }: { meeting: any; speakers: { speaker: string | null; n: number }[]; jumpSeq: number | null; onSpeakersSaved: () => void }) {
  const [segs, setSegs] = useState<Seg[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Seg[] | null>(null);
  const [hit, setHit] = useState<number | null>(jumpSeq);
  const [map, setMap] = useState<Record<string, string>>(meeting.speaker_map || {});
  const [showRename, setShowRename] = useState(false);
  const refs = useRef<Record<number, HTMLDivElement | null>>({});

  const load = useCallback(
    async (opts: { after?: number; around?: number; append?: boolean }) => {
      const p = new URLSearchParams({ limit: '200' });
      if (opts.around !== undefined) p.set('around', String(opts.around));
      else p.set('after', String(opts.after ?? -1));
      const r = await fetch(`/api/meetings/${meeting.id}/transcript?${p}`);
      const b = await r.json();
      setSegs((prev) => (opts.append ? [...prev, ...b.segments] : b.segments));
      setHasMore(b.hasMore);
      setTotal(b.total);
    },
    [meeting.id],
  );

  useEffect(() => {
    if (jumpSeq !== null) load({ around: jumpSeq });
    else load({});
  }, [jumpSeq, load]);

  useEffect(() => {
    if (hit !== null) refs.current[hit]?.scrollIntoView({ block: 'center' });
  }, [hit, segs]);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return setResults(null);
    const r = await fetch(`/api/meetings/${meeting.id}/transcript?q=${encodeURIComponent(query)}`);
    setResults((await r.json()).results);
  };

  const jump = async (seq: number) => {
    setHit(seq);
    if (!segs.some((s) => s.seq === seq)) await load({ around: seq });
  };

  const name = (s: string | null) => (s && map[s]) || s || 'Unknown Speaker';

  return (
    <div className="grid2" style={{ gridTemplateColumns: '2fr 1fr', alignItems: 'start' }}>
      <div className="panel">
        <div className="spread">
          <h2>Transcript <span className="muted small">({total} segments)</span></h2>
          <button className="btn sm" onClick={() => setShowRename(!showRename)}>Rename speakers</button>
        </div>
        {showRename && (
          <form className="alert" style={{ marginBottom: 12 }} onSubmit={async (e) => {
            e.preventDefault();
            await fetch(`/api/meetings/${meeting.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ speakerMap: map }) });
            setShowRename(false);
            onSpeakersSaved();
          }}>
            <div className="small muted" style={{ marginBottom: 8 }}>Speaker labels come from the transcription service. Assign names only when you know who spoke.</div>
            {speakers.filter((s) => s.speaker).map((s) => (
              <div className="row" key={s.speaker!} style={{ marginBottom: 6, flexWrap: 'nowrap' }}>
                <span style={{ width: 110 }}>{s.speaker} →</span>
                <input aria-label={`Name for ${s.speaker}`} value={map[s.speaker!] || ''} placeholder="Name" onChange={(e) => setMap({ ...map, [s.speaker!]: e.target.value })} />
              </div>
            ))}
            {!speakers.some((s) => s.speaker) && <div className="small">This transcript has no speaker labels (the transcription service did not provide diarization).</div>}
            <button className="btn sm primary">Save names</button>
          </form>
        )}
        <div className="transcript" style={{ maxHeight: 640 }} data-testid="transcript">
          {segs.length === 0 && <p className="muted">No transcript.</p>}
          {segs[0]?.seq > 0 && jumpSeq !== null && <button className="btn sm" onClick={() => load({})}>Show from start</button>}
          {segs.map((s) => (
            <div key={s.seq} ref={(el) => { refs.current[s.seq] = el; }} className={`seg ${hit === s.seq ? 'hit' : ''}`}>
              <div className="meta">
                [{clock(meeting.start_time, s.offset_ms, meeting.timezone)}]
                {s.confidence !== null && s.confidence !== undefined && <span title="Transcription confidence"> · {Math.round(s.confidence * 100)}%</span>}
              </div>
              <span className="spk">{name(s.speaker)}:</span> {s.text}
            </div>
          ))}
          {hasMore && <button className="btn sm" onClick={() => load({ after: segs[segs.length - 1].seq, append: true })}>Load more</button>}
        </div>
      </div>
      <div className="panel">
        <h2>Search transcript</h2>
        <form onSubmit={search} className="row" style={{ flexWrap: 'nowrap' }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. school registration" data-testid="transcript-search" />
          <button className="btn">Search</button>
        </form>
        {results && (
          <div style={{ marginTop: 12 }} data-testid="transcript-results">
            {results.length === 0 && <p className="muted">No matches.</p>}
            {results.map((r) => (
              <button key={r.seq} className="seg" style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit' }} onClick={() => jump(r.seq)}>
                <div className="meta">{clock(meeting.start_time, r.offset_ms, meeting.timezone)} · {name(r.speaker)}</div>
                <Highlighted html={r.highlight || r.text} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
