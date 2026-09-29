'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { fmtDeadline, STATUS_BADGE, statusLabel } from '@/lib/format';
import { patchAction } from '../meetings/[id]/ActionsTab';

export default function ActionDashboard() {
  const [status, setStatus] = useState('open');
  const [owner, setOwner] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [edit, setEdit] = useState<string | null>(null);
  const [draft, setDraft] = useState<any>({});
  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (owner) p.set('owner', owner);
    const r = await fetch(`/api/actions?${p}`);
    setRows((await r.json()).actions || []);
  }, [status, owner]);
  useEffect(() => {
    load();
  }, [load]);
  const today = new Date().toISOString().slice(0, 10);
  const overdue = (a: any) => a.deadline_date && String(a.deadline_date).slice(0, 10) < today && ['pending', 'in_progress'].includes(a.status);

  return (
    <div className="stack">
      <h1>Action Items</h1>
      <div className="panel row">
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 180 }} aria-label="Status filter">
          <option value="open">My pending actions</option>
          <option value="">All statuses</option>
          {['pending', 'in_progress', 'completed', 'cancelled'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
        <input placeholder="Filter by owner" value={owner} onChange={(e) => setOwner(e.target.value)} style={{ maxWidth: 200 }} />
      </div>
      <div className="panel">
        <table data-testid="action-dashboard">
          <thead><tr><th>Task</th><th>Owner</th><th>Meeting</th><th>Deadline</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map((a) =>
              edit === a.id ? (
                <tr key={a.id}>
                  <td><input value={draft.task} onChange={(e) => setDraft({ ...draft, task: e.target.value })} /></td>
                  <td><input value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} /></td>
                  <td className="small">{a.meeting_title}</td>
                  <td><input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></td>
                  <td colSpan={2}>
                    <button className="btn sm primary" onClick={async () => {
                      const body: any = { task: draft.task, owner: draft.owner || 'Unassigned' };
                      if (draft.date !== (a.deadline_date ? String(a.deadline_date).slice(0, 10) : '')) Object.assign(body, { deadlineDate: draft.date || null, deadlineText: draft.date || 'Not specified' });
                      await patchAction(a.id, body);
                      setEdit(null);
                      load();
                    }}>Save</button>{' '}
                    <button className="btn sm" onClick={() => setEdit(null)}>Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={a.id}>
                  <td>{a.task}</td>
                  <td>{a.owner}</td>
                  <td className="small"><Link href={`/meetings/${a.meeting_id}?tab=actions`}>{a.meeting_title}</Link>{a.is_demo && <span className="demo-tag">DEMO</span>}</td>
                  <td className="small" style={{ color: overdue(a) ? 'var(--danger)' : undefined }}>{fmtDeadline(a.deadline_date, a.deadline_text)}{overdue(a) ? ' · overdue' : ''}</td>
                  <td><span className={`badge ${STATUS_BADGE[a.status]}`}>{statusLabel(a.status)}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {a.status !== 'completed' && <button className="btn sm" onClick={async () => { await patchAction(a.id, { status: 'completed' }); load(); }}>Complete</button>}{' '}
                    <button className="btn sm" onClick={() => { setEdit(a.id); setDraft({ task: a.task, owner: a.owner, date: a.deadline_date ? String(a.deadline_date).slice(0, 10) : '' }); }}>Edit</button>{' '}
                    <Link className="btn sm" href={`/meetings/${a.meeting_id}?tab=actions`}>Open meeting</Link>
                  </td>
                </tr>
              ),
            )}
            {!rows.length && <tr><td colSpan={6} className="muted">No action items.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
