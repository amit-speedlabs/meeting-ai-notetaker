import { notFound } from 'next/navigation';
import { one } from '@/lib/db';
import { loadReport } from '@/lib/report';
import type { MeetingRow } from '@/lib/meetings';

export const dynamic = 'force-dynamic';

/** Public, read-only summary (no transcript, no audio). Revocable from the meeting page. */
export default async function Shared({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(token)) notFound();
  const m = await one<MeetingRow>('select * from meetings where share_token = $1', [token]);
  if (!m) notFound();
  const r = await loadReport(m);
  const L = ({ xs }: { xs: string[] }) => (xs.length ? <ul className="clean">{xs.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="muted">None</p>);
  return (
    <main style={{ maxWidth: 820, margin: '0 auto' }}>
      <div className="panel">
        <div className="muted small">Shared meeting summary · Meeting AI Notetaker</div>
        <h1>{r.title}{r.isDemo && <span className="demo-tag">DEMO DATA</span>}</h1>
        <div className="small muted">{r.type} · {r.date} · {r.duration} · {r.participants.join(', ')}</div>
        <h2 style={{ marginTop: 20 }}>Executive Summary</h2>
        <p>{r.summary}</p>
        <h3>Key Discussion Points</h3><L xs={r.keyPoints} />
        <h3>Decisions Made</h3><L xs={r.decisions} />
        <h3>Action Items</h3>
        <table><thead><tr><th>Action</th><th>Owner</th><th>Deadline</th><th>Status</th></tr></thead>
          <tbody>{r.actions.map((a, i) => <tr key={i}><td>{a.task}</td><td>{a.owner}</td><td>{a.deadline}</td><td>{a.status}</td></tr>)}</tbody></table>
        <h3>Open Questions</h3><L xs={r.openQuestions} />
        <h3>Important Numbers</h3><L xs={r.numbers} />
        <h3>Next Steps</h3><L xs={r.nextSteps} />
      </div>
    </main>
  );
}
