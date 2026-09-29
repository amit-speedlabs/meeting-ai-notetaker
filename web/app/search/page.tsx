import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { globalSearch } from '@/lib/search';
import { fmtDay, clock, fmtDeadline } from '@/lib/format';

export const dynamic = 'force-dynamic';

function Hl({ text }: { text: string }) {
  return <>{text.split(/(«[^»]*»)/g).map((p, i) => (p.startsWith('«') ? <mark key={i}>{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>))}</>;
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const term = ((await searchParams).q || '').trim();
  return (
    <AppShell>
      {async (user) => {
        const r = term ? await globalSearch(user.id, term) : null;
        return (
          <div className="stack">
            <h1>Search</h1>
            <form className="panel row" method="get" style={{ flexWrap: 'nowrap' }}>
              <input name="q" defaultValue={term} placeholder='Search all meetings — e.g. "AI Olympiad", "school registration", "Vivek", "pending kits"' autoFocus data-testid="global-search" />
              <button className="btn primary">Search</button>
            </form>
            {r && (
              <div className="grid2" style={{ gridTemplateColumns: '2fr 1fr', alignItems: 'start' }}>
                <div className="panel" data-testid="search-transcript">
                  <h2>Transcript matches ({r.transcript.length})</h2>
                  {r.transcript.length === 0 && <p className="muted">No transcript matches.</p>}
                  {r.transcript.map((t: any) => (
                    <div className="seg" key={t.meeting_id + t.seq}>
                      <div className="meta">
                        <Link href={`/meetings/${t.meeting_id}?tab=transcript&seq=${t.seq}`}><b>{t.title}</b></Link>
                        {t.is_demo && <span className="demo-tag">DEMO</span>} · {fmtDay(t.start_time, t.timezone)} · {clock(t.start_time, t.offset_ms, t.timezone)}
                      </div>
                      <span className="spk">{(t.speaker && t.speaker_map?.[t.speaker]) || t.speaker || 'Unknown Speaker'}:</span> <Hl text={t.highlight || t.text} />
                    </div>
                  ))}
                </div>
                <div className="stack">
                  <div className="panel">
                    <h2>Meetings ({r.meetings.length})</h2>
                    {r.meetings.length === 0 ? <p className="muted">None.</p> : <ul className="clean">{r.meetings.map((m: any) => <li key={m.id}><Link href={`/meetings/${m.id}`}>{m.title}</Link> <span className="small muted">{fmtDay(m.start_time)} · matched {m.matched}</span></li>)}</ul>}
                  </div>
                  <div className="panel">
                    <h2>Action items ({r.actions.length})</h2>
                    {r.actions.length === 0 ? <p className="muted">None.</p> : <ul className="clean">{r.actions.map((a: any) => <li key={a.id}>{a.task} <span className="small muted">— {a.owner}, {fmtDeadline(a.deadline_date, a.deadline_text)} · <Link href={`/meetings/${a.meeting_id}?tab=actions`}>{a.title}</Link></span></li>)}</ul>}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      }}
    </AppShell>
  );
}
