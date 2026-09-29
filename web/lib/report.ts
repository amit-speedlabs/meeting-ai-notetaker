import 'server-only';
import { one, q } from './db';
import { MeetingRow, speakerName, clockTime } from './meetings';

export type Report = Awaited<ReturnType<typeof loadReport>>;

export async function loadReport(m: MeetingRow, opts: { includeTranscript?: boolean } = {}) {
  const notes = await one('select * from notes where meeting_id = $1', [m.id]);
  const participants = await q('select name, email, organisation from participants where meeting_id = $1 order by name', [m.id]);
  const actions = await q(
    `select task, owner, deadline_date, deadline_text, status from action_items where meeting_id = $1 and status <> 'cancelled' order by created_at`,
    [m.id],
  );
  const speakers = await q<{ speaker: string | null }>('select distinct speaker from transcript_segments where meeting_id = $1', [m.id]);
  const transcript = opts.includeTranscript
    ? (await q('select offset_ms, speaker, text from transcript_segments where meeting_id = $1 order by seq', [m.id])).map((s: any) => ({
        time: clockTime(m.start_time, s.offset_ms, m.timezone),
        speaker: speakerName(m.speaker_map, s.speaker),
        text: s.text,
      }))
    : [];
  const names = participants.length
    ? participants.map((p: any) => p.name)
    : speakers.map((s) => speakerName(m.speaker_map, s.speaker)).filter((n) => n !== 'Unknown Speaker');
  return {
    title: m.title,
    type: m.meeting_type,
    date: m.start_time ? new Date(m.start_time).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: m.timezone }) : '—',
    duration: `${Math.max(1, Math.round(m.duration_seconds / 60))} minutes`,
    participants: names as string[],
    isDemo: m.is_demo,
    summary: notes?.summary || '',
    keyPoints: (notes?.key_points || []) as string[],
    decisions: (notes?.decisions || []) as string[],
    openQuestions: (notes?.open_questions || []) as string[],
    risks: (notes?.risks || []) as string[],
    numbers: (notes?.important_numbers || []) as string[],
    nextSteps: (notes?.next_steps || []) as string[],
    actions: actions.map((a: any) => ({
      task: a.task,
      owner: a.owner,
      deadline: a.deadline_date ? `${fmtDate(a.deadline_date)}${a.deadline_text && a.deadline_text !== 'Not specified' ? ` (${a.deadline_text})` : ''}` : a.deadline_text,
      status: a.status.replace('_', ' '),
    })),
    transcript,
  };
}

export function fmtDate(d: string | Date) {
  const x = typeof d === 'string' ? new Date(d.length === 10 ? d + 'T00:00:00Z' : d) : d;
  return x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : '- None');

export function toMarkdown(r: Report) {
  const out = [
    `# Meeting Summary${r.isDemo ? ' (DEMO DATA)' : ''}`,
    `**Meeting:** ${r.title}  `,
    `**Type:** ${r.type}  `,
    `**Date:** ${r.date}  `,
    `**Duration:** ${r.duration}  `,
    `**Participants:** ${r.participants.join(', ') || '—'}`,
    `## Executive Summary\n${r.summary || '—'}`,
    `## Key Discussion Points\n${list(r.keyPoints)}`,
    `## Decisions Made\n${list(r.decisions)}`,
    `## Action Items\n| Action | Owner | Deadline | Status |\n| --- | --- | --- | --- |\n${
      r.actions.map((a) => `| ${esc(a.task)} | ${esc(a.owner)} | ${esc(a.deadline)} | ${a.status} |`).join('\n') || '| None | | | |'
    }`,
    `## Open Questions\n${list(r.openQuestions)}`,
    `## Risks / Blockers\n${list(r.risks)}`,
    `## Important Numbers\n${list(r.numbers)}`,
    `## Next Steps\n${list(r.nextSteps)}`,
  ];
  if (r.transcript.length) out.push(`## Transcript\n${r.transcript.map((t) => `**[${t.time}] ${t.speaker}:** ${t.text}`).join('\n\n')}`);
  return out.join('\n\n') + '\n';
}
const esc = (s: string) => s.replace(/\|/g, '\\|');

export function toText(r: Report) {
  const sec = (h: string, xs: string[]) => `${h.toUpperCase()}\n${xs.length ? xs.map((x) => `  • ${x}`).join('\n') : '  • None'}`;
  const out = [
    `MEETING SUMMARY${r.isDemo ? ' (DEMO DATA)' : ''}`,
    `Meeting: ${r.title}\nType: ${r.type}\nDate: ${r.date}\nDuration: ${r.duration}\nParticipants: ${r.participants.join(', ') || '—'}`,
    `EXECUTIVE SUMMARY\n${r.summary || '—'}`,
    sec('Key discussion points', r.keyPoints),
    sec('Decisions made', r.decisions),
    `ACTION ITEMS\n${r.actions.length ? r.actions.map((a) => `  • ${a.task} — Owner: ${a.owner} — Deadline: ${a.deadline} — ${a.status}`).join('\n') : '  • None'}`,
    sec('Open questions', r.openQuestions),
    sec('Risks / blockers', r.risks),
    sec('Important numbers', r.numbers),
    sec('Next steps', r.nextSteps),
  ];
  if (r.transcript.length) out.push(`TRANSCRIPT\n${r.transcript.map((t) => `[${t.time}] ${t.speaker}: ${t.text}`).join('\n')}`);
  return out.join('\n\n') + '\n';
}

export function actionsText(r: Report) {
  return r.actions.map((a) => `- ${a.task} — ${a.owner} — ${a.deadline} (${a.status})`).join('\n') || 'No action items.';
}
