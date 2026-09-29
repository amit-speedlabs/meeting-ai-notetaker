import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { listMeetings } from '@/lib/meeting-queries';
import { MEETING_TYPES } from '@/lib/meetings';
import { fmtDay, fmtDuration, STATUS_BADGE, statusLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';
type SP = { q?: string; type?: string; status?: string; participant?: string; owner?: string; from?: string; to?: string; sort?: string; page?: string };

export default async function Library({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const PER = 25;
  return (
    <AppShell>
      {async (user) => {
        const rows = await listMeetings(user.id, { ...sp, sort: (sp.sort as any) || 'newest', limit: PER + 1, offset: (page - 1) * PER });
        const qs = (p: number) => '?' + new URLSearchParams({ ...(sp as Record<string, string>), page: String(p) }).toString();
        return (
          <div className="stack">
            <div className="spread">
              <h1>Meetings</h1>
              <div className="row">
                <Link className="btn" href="/meet">+ Google Meet</Link>
                <Link className="btn primary" href="/meetings/new?mode=offline">+ Offline Meeting</Link>
              </div>
            </div>
            <form className="panel row" method="get" data-testid="library-filters">
              <input name="q" placeholder="Search keyword" defaultValue={sp.q} style={{ maxWidth: 200 }} />
              <select name="type" defaultValue={sp.type || ''} style={{ maxWidth: 170 }}>
                <option value="">All types</option>
                {MEETING_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
              <select name="status" defaultValue={sp.status || ''} style={{ maxWidth: 150 }}>
                <option value="">Any status</option>
                {['COMPLETED', 'RECORDING', 'PAUSED', 'PROCESSING', 'FAILED', 'NOT_STARTED'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
              <input name="participant" placeholder="Participant" defaultValue={sp.participant} style={{ maxWidth: 140 }} />
              <input name="owner" placeholder="Action owner" defaultValue={sp.owner} style={{ maxWidth: 140 }} />
              <input name="from" type="date" defaultValue={sp.from} style={{ maxWidth: 150 }} aria-label="From date" />
              <input name="to" type="date" defaultValue={sp.to} style={{ maxWidth: 150 }} aria-label="To date" />
              <select name="sort" defaultValue={sp.sort || 'newest'} style={{ maxWidth: 130 }} aria-label="Sort">
                <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="longest">Longest</option><option value="shortest">Shortest</option>
              </select>
              <button className="btn">Apply</button>
              <Link href="/meetings" className="small">Reset</Link>
            </form>
            <div className="panel">
              {rows.length === 0 ? <p className="muted">No meetings match.</p> : (
                <table data-testid="library-table">
                  <thead><tr><th>Meeting</th><th>Type</th><th>Date</th><th>Duration</th><th>Participants</th><th>Open actions</th><th>Status</th></tr></thead>
                  <tbody>
                    {rows.slice(0, PER).map((m: any) => (
                      <tr key={m.id}>
                        <td><Link href={`/meetings/${m.id}`}>{m.title}</Link>{m.is_demo && <span className="demo-tag">DEMO</span>}</td>
                        <td className="small">{m.meeting_type}</td>
                        <td>{fmtDay(m.start_time || m.created_at)}</td>
                        <td>{fmtDuration(m.duration_seconds)}</td>
                        <td>{m.participant_count || m.speaker_count || '—'}</td>
                        <td>{m.open_actions}</td>
                        <td><span className={`badge ${STATUS_BADGE[m.status]}`}>{statusLabel(m.status)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="row" style={{ marginTop: 10 }}>
                {page > 1 && <Link className="btn sm" href={qs(page - 1)}>← Previous</Link>}
                {rows.length > PER && <Link className="btn sm" href={qs(page + 1)}>Next →</Link>}
              </div>
            </div>
          </div>
        );
      }}
    </AppShell>
  );
}
