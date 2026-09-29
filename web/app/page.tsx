import Link from 'next/link';
import AppShell from '@/components/AppShell';
import ProviderBanner from '@/components/ProviderBanner';
import RecoveryBanner from '@/components/RecoveryBanner';
import { q, one } from '@/lib/db';
import { listMeetings } from '@/lib/meeting-queries';
import { purgeExpiredAudio } from '@/lib/retention';
import { fmtDay, fmtDuration, fmtDeadline, STATUS_BADGE, statusLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function Dashboard() {
  return (
    <AppShell>
      {async (user) => {
        purgeExpiredAudio(user.id).catch(() => {});
        const recent = await listMeetings(user.id, { sort: 'newest', limit: 8 });
        const interrupted = await q(
          `select id, title, mode, status from meetings where created_by = $1 and status in ('RECORDING','PAUSED','NOT_STARTED')
             and coalesce(last_activity_at, created_at) < now() - interval '2 minutes' and created_at > now() - interval '7 days' order by created_at desc`,
          [user.id],
        );
        const stats = await one<{ pending: number; due_today: number; overdue: number }>(
          `select count(*) filter (where a.status in ('pending','in_progress'))::int as pending,
             count(*) filter (where a.status in ('pending','in_progress') and a.deadline_date = current_date)::int as due_today,
             count(*) filter (where a.status in ('pending','in_progress') and a.deadline_date < current_date)::int as overdue
           from action_items a join meetings m on m.id = a.meeting_id where m.created_by = $1`,
          [user.id],
        );
        const due = await q(
          `select a.id, a.task, a.owner, a.deadline_date, a.deadline_text, a.status, a.meeting_id, m.title from action_items a join meetings m on m.id = a.meeting_id
           where m.created_by = $1 and a.status in ('pending','in_progress') order by (a.deadline_date is null), a.deadline_date, a.created_at desc limit 6`,
          [user.id],
        );
        const today = await q(
          `select id, title, status from meetings where created_by = $1 and coalesce(start_time, created_at)::date = current_date order by created_at desc`,
          [user.id],
        );
        return (
          <div className="stack">
            <div>
              <h1 style={{ marginBottom: 4 }}>
                {greeting()}, {user.name.split(' ')[0]}
              </h1>
              <div className="muted">Start a meeting or pick up where you left off.</div>
            </div>
            <ProviderBanner />
            <RecoveryBanner interrupted={interrupted as any} />
            <div className="grid2">
              <Link href="/meet" className="bigbtn" data-testid="start-meet">
                <strong>+ Google Meet</strong>
                <span className="muted">Take notes from a Google Meet (uses the Chrome extension)</span>
              </Link>
              <Link href="/meetings/new?mode=offline" className="bigbtn" data-testid="start-offline">
                <strong>+ Offline Meeting</strong>
                <span className="muted">Use your microphone to capture an in-person meeting</span>
              </Link>
            </div>
            <div className="row small">
              <span className="muted">Have a recording already?</span>
              <Link href="/meetings/new?mode=upload">Upload meeting recording</Link>
            </div>

            <div className="grid3">
              <div className="panel">
                <div className="muted small">Pending actions</div>
                <div className="stat">{stats?.pending ?? 0}</div>
              </div>
              <div className="panel">
                <div className="muted small">Due today</div>
                <div className="stat">{stats?.due_today ?? 0}</div>
              </div>
              <div className="panel">
                <div className="muted small">Overdue</div>
                <div className="stat" style={{ color: stats?.overdue ? 'var(--danger)' : undefined }}>{stats?.overdue ?? 0}</div>
              </div>
            </div>

            <div className="grid2" style={{ alignItems: 'start' }}>
              <div className="panel">
                <div className="spread">
                  <h2>Recent Meetings</h2>
                  <Link href="/meetings" className="small">View all</Link>
                </div>
                {recent.length === 0 ? (
                  <p className="muted">No meetings yet.</p>
                ) : (
                  <table>
                    <thead>
                      <tr><th>Meeting</th><th>Date</th><th>Duration</th><th>People</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {recent.map((m: any) => (
                        <tr key={m.id}>
                          <td>
                            <Link href={m.status === 'RECORDING' || m.status === 'PAUSED' ? `/meetings/${m.id}/record` : `/meetings/${m.id}`}>{m.title}</Link>
                            {m.is_demo && <span className="demo-tag">DEMO</span>}
                          </td>
                          <td>{fmtDay(m.start_time || m.created_at)}</td>
                          <td>{fmtDuration(m.duration_seconds)}</td>
                          <td>{m.participant_count || m.speaker_count || '—'}</td>
                          <td><span className={`badge ${STATUS_BADGE[m.status]}`}>{statusLabel(m.status)}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="stack">
                <div className="panel">
                  <div className="spread">
                    <h2>Action Items Due</h2>
                    <Link href="/actions" className="small">All actions</Link>
                  </div>
                  {due.length === 0 ? (
                    <p className="muted">Nothing pending.</p>
                  ) : (
                    <table>
                      <tbody>
                        {due.map((a: any) => (
                          <tr key={a.id}>
                            <td>
                              {a.task}
                              <div className="small muted">
                                {a.owner} · <Link href={`/meetings/${a.meeting_id}?tab=actions`}>{a.title}</Link>
                              </div>
                            </td>
                            <td className="small" style={{ whiteSpace: 'nowrap' }}>{fmtDeadline(a.deadline_date, a.deadline_text)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="panel">
                  <h2>Today&apos;s Meetings</h2>
                  {today.length === 0 ? <p className="muted" style={{ margin: 0 }}>None yet today.</p> : (
                    <ul className="clean">{today.map((m: any) => <li key={m.id}><Link href={`/meetings/${m.id}`}>{m.title}</Link> <span className="small muted">{statusLabel(m.status)}</span></li>)}</ul>
                  )}
                  <h3>Upcoming</h3>
                  <p className="muted small" style={{ margin: 0 }}>Calendar integration is planned for a later version. Start meetings manually for now.</p>
                </div>
              </div>
            </div>
          </div>
        );
      }}
    </AppShell>
  );
}
