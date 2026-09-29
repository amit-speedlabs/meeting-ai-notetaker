'use client';
import { fmtDeadline } from '@/lib/format';

export default function LiveNotes({ notes, actions, updatedAt }: { notes: any; actions: any[]; updatedAt?: string | null }) {
  const list = (title: string, xs: string[] | undefined, testid?: string) => (
    <div data-testid={testid}>
      <h3>{title}</h3>
      {xs && xs.length ? <ul className="clean">{xs.map((x, i) => <li key={i}>{x}</li>)}</ul> : <div className="muted small">None yet</div>}
    </div>
  );
  return (
    <div>
      {!notes ? (
        <p className="muted">Notes will appear after the first few minutes of conversation.</p>
      ) : (
        <>
          {notes.summary && <p style={{ marginTop: 0 }}>{notes.summary}</p>}
          {list('Key Discussion Points', notes.key_points)}
          {list('Decisions', notes.decisions, 'live-decisions')}
          <h3>Action Items</h3>
          {actions.length ? (
            <table data-testid="live-actions">
              <thead><tr><th>Action</th><th>Owner</th><th>Deadline</th></tr></thead>
              <tbody>{actions.map((a) => <tr key={a.id}><td>{a.task}</td><td>{a.owner}</td><td className="small">{fmtDeadline(a.deadline_date, a.deadline_text)}</td></tr>)}</tbody>
            </table>
          ) : <div className="muted small">None yet</div>}
          {list('Questions / Open Issues', notes.open_questions)}
          {list('Risks / Blockers', notes.risks)}
          {list('Important Numbers', notes.important_numbers)}
        </>
      )}
      {updatedAt && <div className="small muted" style={{ marginTop: 10 }}>Notes updated {new Date(updatedAt).toLocaleTimeString()}</div>}
    </div>
  );
}
