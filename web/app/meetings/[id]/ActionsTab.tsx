'use client';
import { Fragment, useState } from 'react';
import { fmtDeadline, STATUS_BADGE, statusLabel } from '@/lib/format';

const STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];

export async function patchAction(id: string, body: any) {
  const r = await fetch(`/api/actions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) alert((await r.json().catch(() => ({}))).error || 'Update failed');
}

export default function ActionsTab({ meetingId, actions, onChange, compact }: { meetingId: string; actions: any[]; onChange: () => void; compact?: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, any[]>>({});
  const [openC, setOpenC] = useState<string | null>(null);
  const visible = actions.filter((a) => !compact || a.status !== 'cancelled');

  if (compact) {
    return visible.length ? (
      <table data-testid="overview-actions">
        <thead><tr><th>Action</th><th>Owner</th><th>Deadline</th><th>Status</th></tr></thead>
        <tbody>
          {visible.map((a) => (
            <tr key={a.id}>
              <td style={{ textDecoration: a.status === 'completed' ? 'line-through' : undefined }}>{a.task}</td>
              <td>{a.owner}</td>
              <td className="small">{fmtDeadline(a.deadline_date, a.deadline_text)}</td>
              <td><span className={`badge ${STATUS_BADGE[a.status]}`}>{statusLabel(a.status)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : <div className="muted small">No action items.</div>;
  }

  const loadComments = async (id: string) => {
    const r = await fetch(`/api/actions/${id}/comments`);
    setComments({ ...comments, [id]: (await r.json()).comments });
    setOpenC(openC === id ? null : id);
  };

  return (
    <div>
      <table data-testid="actions-table">
        <thead><tr><th>Action</th><th>Owner</th><th>Deadline</th><th>Status</th><th /></tr></thead>
        <tbody>
          {visible.map((a) =>
            editing === a.id ? (
              <EditRow key={a.id} a={a} onDone={() => { setEditing(null); onChange(); }} />
            ) : (
              <Fragment key={a.id}>
                <tr>
                  <td>
                    {a.task}
                    {a.source === 'manual' && <span className="badge gray" style={{ marginLeft: 6 }}>manual</span>}
                    {a.source_quote && <div className="small muted" title="Source quote">“{a.source_quote}”</div>}
                  </td>
                  <td>{a.owner}</td>
                  <td className="small">{fmtDeadline(a.deadline_date, a.deadline_text)}</td>
                  <td>
                    <select value={a.status} style={{ width: 'auto' }} aria-label="Status" onChange={async (e) => { await patchAction(a.id, { status: e.target.value }); onChange(); }}>
                      {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                    </select>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {a.status !== 'completed' && <button className="btn sm" onClick={async () => { await patchAction(a.id, { status: 'completed' }); onChange(); }}>Complete</button>}{' '}
                    <button className="btn sm" onClick={() => setEditing(a.id)}>Edit</button>{' '}
                    <button className="btn sm" onClick={() => loadComments(a.id)}>Comments</button>{' '}
                    <button className="btn sm ghost" aria-label="Delete action" onClick={async () => { if (confirm('Delete this action item?')) { await fetch(`/api/actions/${a.id}`, { method: 'DELETE' }); onChange(); } }}>✕</button>
                  </td>
                </tr>
                {openC === a.id && (
                  <tr>
                    <td colSpan={5}>
                      {(comments[a.id] || []).map((c) => <div key={c.id} className="small"><b>{c.user_name}</b> <span className="muted">{new Date(c.created_at).toLocaleString()}</span>: {c.body}</div>)}
                      <form className="row" style={{ marginTop: 6, flexWrap: 'nowrap' }} onSubmit={async (e) => {
                        e.preventDefault();
                        const input = (e.currentTarget.elements.namedItem('body') as HTMLInputElement);
                        if (!input.value.trim()) return;
                        const r = await fetch(`/api/actions/${a.id}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: input.value }) });
                        const { comment } = await r.json();
                        setComments({ ...comments, [a.id]: [...(comments[a.id] || []), comment] });
                        input.value = '';
                      }}>
                        <input name="body" placeholder="Add a comment" />
                        <button className="btn sm">Add</button>
                      </form>
                    </td>
                  </tr>
                )}
              </Fragment>
            ),
          )}
          {!visible.length && <tr><td colSpan={5} className="muted">No action items.</td></tr>}
        </tbody>
      </table>
      <AddAction meetingId={meetingId} onAdded={onChange} />
    </div>
  );
}

function EditRow({ a, onDone }: { a: any; onDone: () => void }) {
  const [task, setTask] = useState(a.task);
  const [owner, setOwner] = useState(a.owner);
  const [date, setDate] = useState(a.deadline_date ? String(a.deadline_date).slice(0, 10) : '');
  return (
    <tr>
      <td><input value={task} onChange={(e) => setTask(e.target.value)} aria-label="Task" /></td>
      <td><input value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner" /></td>
      <td><input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Deadline" /></td>
      <td colSpan={2}>
        <button className="btn sm primary" onClick={async () => {
          const body: any = { task, owner: owner || 'Unassigned' };
          const prev = a.deadline_date ? String(a.deadline_date).slice(0, 10) : '';
          if (date !== prev) Object.assign(body, { deadlineDate: date || null, deadlineText: date ? date : 'Not specified' });
          await patchAction(a.id, body);
          onDone();
        }}>Save</button>{' '}
        <button className="btn sm" onClick={onDone}>Cancel</button>
      </td>
    </tr>
  );
}

function AddAction({ meetingId, onAdded }: { meetingId: string; onAdded: () => void }) {
  const [task, setTask] = useState('');
  const [owner, setOwner] = useState('');
  const [deadline, setDeadline] = useState('');
  return (
    <form className="row" style={{ marginTop: 12, flexWrap: 'nowrap' }} onSubmit={async (e) => {
      e.preventDefault();
      if (!task.trim()) return;
      await fetch('/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingId, task, owner: owner || undefined, deadline: deadline || undefined }) });
      setTask(''); setOwner(''); setDeadline('');
      onAdded();
    }}>
      <input placeholder="New action" value={task} onChange={(e) => setTask(e.target.value)} />
      <input placeholder="Owner (optional)" value={owner} onChange={(e) => setOwner(e.target.value)} style={{ maxWidth: 170 }} />
      <input placeholder="Deadline e.g. Friday" value={deadline} onChange={(e) => setDeadline(e.target.value)} style={{ maxWidth: 190 }} />
      <button className="btn sm primary">Add action</button>
    </form>
  );
}
